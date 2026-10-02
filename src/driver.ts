// driver.ts — the observation seam.
//
// A playtest needs three things from a game: show me the state, tell me what I
// may do, and tell me when it is my turn. How a game answers differs enormously
// (a text game prints lines; a TUI redraws a screen; an engine can hand over
// structured state), but the SHAPE of the answer does not. That shape is
// `Observation`, and a `Driver` is anything that can produce one.
//
// The ordering here is deliberate and evidence-led. Structured text beats
// pixels by a wide margin for agent play — accessibility-tree observations
// roughly double screenshot-only success on OSWorld (12.24% vs 5.26%), and on
// BALROG *adding* vision lowered several models outright (GPT-4o 32.34% ->
// 22.56%). Unscaffolded pixel play sits near zero (VideoGameBench: 0.48% game
// completion). The strongest open-ended game agent, Voyager, never saw a pixel;
// it drove a structured API.
//
// So `text` is mandatory on every observation and pixels are an optional
// attachment, never the only channel. A game that can describe itself should.

/** What the player may legally do right now. */
export type ActionSpace =
  /** Free text: a parser game, or anything that reads a line. */
  | { kind: 'free-text' }
  /** A fixed key set: a TUI that reads single keypresses. */
  | { kind: 'keys'; keys: string[] }
  /** An explicit menu. Cheapest to validate, and the least ambiguous to play. */
  | { kind: 'choice'; options: Array<{ id: string; label: string }> }
  /** A named call surface, described by JSON Schema — the engine-bridge case. */
  | { kind: 'schema'; schema: unknown };

export type Action =
  | { kind: 'line'; line: string }
  | { kind: 'key'; key: string }
  | { kind: 'choose'; id: string }
  | { kind: 'call'; name: string; args?: unknown };

/** Why the driver decided it was the player's turn, best evidence first. */
export type ReadyReason =
  /** The game said so explicitly. The only sound answer. */
  | 'sentinel'
  /** The terminal entered a line-reading mode (bracketed paste). */
  | 'ready-signal'
  /** A configured pattern matched the rendered prompt. */
  | 'prompt'
  /** Nothing matched; the game simply went quiet. A guess, and labelled as one. */
  | 'idle'
  | 'exit'
  | 'timeout';

export type Observation = {
  /**
   * The primary channel. ALWAYS present: every driver renders its state to
   * text, because that is the channel the evidence supports.
   */
  text: string;
  /** A terminal grid, when the driver emulates one. */
  grid?: {
    rows: number;
    cols: number;
    lines: string[];
    cursor: { x: number; y: number };
    /** True while the game is on the alternate screen buffer (a full-screen TUI). */
    altScreen: boolean;
  };
  /** Structured state, when the game exposes it. The strongest channel. */
  state?: unknown;
  /** A screenshot. An attachment — never the sole channel. */
  image?: { mime: string; base64: string };
  /** What the player may do now. Lets the runner reject an illegal action
   *  before spending a turn on it, and distinguishes "the model cannot play"
   *  from "the harness cannot parse". */
  actions?: ActionSpace;
  reason: ReadyReason;
  /**
   * The game's own end cause when the session is over. The engine-bridge
   * protocol sends `win` / `lose` / `quit` / `stuck` / `timeout` here; the
   * seat loop keys on `reason === 'exit' | 'timeout'`, so those protocol
   * strings must not occupy `reason`.
   */
  endCause?: string;
  done: boolean;
  exitCode: number | null;
  /**
   * Set when the child never launched (ENOENT, spawn failed). Distinct from a
   * game that started and then exited; `reason` stays `'exit'` so the seat
   * loop still stops.
   */
  spawnError?: string;
};

export interface Driver {
  /** Identifies the driver in artifacts, e.g. "stdio" or "pty". */
  readonly modality: string;
  /** Start the game and wait for its first observation. */
  start(): Promise<Observation>;
  /** Apply an action and wait for the next observation. */
  step(action: Action): Promise<Observation>;
  /** Stop the game. Safe to call more than once. */
  stop(): Promise<void>;
  /**
   * Restore a fresh session without relaunching the engine. The rpc driver
   * implements this so one process can serve a panel; stdio/pty omit it.
   */
  reset?(): Promise<Observation>;
  /** Anything the game wrote to a diagnostic channel. */
  readonly diagnostics: string;
}

export class ActionError extends Error {
  readonly code = 'E_ACTION';
  constructor(message: string, readonly hint: string) {
    super(message);
    this.name = 'ActionError';
  }
}

/**
 * Render an action as the line a text game would receive. Drivers that only
 * accept lines use this so every action kind has a defined text form rather
 * than failing on an action shape they did not expect.
 */
export function actionToLine(action: Action): string {
  switch (action.kind) {
    case 'line': return action.line;
    case 'key': return action.key;
    case 'choose': return action.id;
    case 'call': return action.args === undefined ? action.name : `${action.name} ${JSON.stringify(action.args)}`;
    default: {
      const unexpected = action as { kind?: unknown };
      throw new ActionError(
        `unknown action kind ${JSON.stringify(unexpected.kind)} — refusing to write "undefined" into the game`,
        'action.kind must be line, key, choose, or call',
      );
    }
  }
}

/** Describe an action space to a player model without naming the mechanics under test. */
export function describeActions(space: ActionSpace | undefined): string {
  if (!space) return '';
  switch (space.kind) {
    case 'free-text': return '';
    case 'keys': return `Keys you may press: ${space.keys.join(' ')}`;
    case 'choice': return `Choose one:\n${space.options.map((o) => `  ${o.id}) ${o.label}`).join('\n')}`;
    case 'schema': return `Reply with one call from this schema:\n${JSON.stringify(space.schema)}`;
    default: return '';
  }
}

/**
 * Map a player-typed string onto a typed Action using the current space.
 * Closed sets match an option id/label or a listed key; anything else stays a
 * line so stdio free-text still has a wire form. The runner calls this and
 * steps the Action; stdio/pty still flatten through actionToLine.
 */
export function actionFromInput(input: string, space?: ActionSpace): Action {
  if (space?.kind === 'choice') {
    const hit = space.options.find((o) => o.id === input || o.label === input) ?? looseChoice(input, space.options);
    if (hit) return { kind: 'choose', id: hit.id };
  } else if (space?.kind === 'keys' && space.keys.includes(input)) {
    return { kind: 'key', key: input };
  }
  return { kind: 'line', line: input };
}

/**
 * The second chance for a closed-set answer, for the shapes models actually reply in.
 *
 * describeActions lists options as `  id) label`, and small models copy that marker:
 * llama3.2:1b answered `weighing-floor)` on every one of fifteen turns against the
 * Godot stage and took zero legal moves. That is the harness's own format coming back,
 * so the list punctuation is stripped. Models also answer by position (llama3.1:8b and
 * llama3.2:3b replied `1`, `2`); a bare number picks the listed option in that order,
 * but only when no option id is itself a number, so it can never shadow a real id.
 */
export function looseChoice(input: string, options: Array<{ id: string; label: string }>): { id: string; label: string } | undefined {
  // The whole listed line echoed back: `long-quay) Walk to The Long Quay`.
  const echoed = /^\s*([^)\s]+)\)\s+\S/.exec(input);
  if (echoed) {
    const byId = options.find((o) => o.id.toLowerCase() === echoed[1].toLowerCase());
    if (byId) return byId;
  }
  const clean = input.trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^(?:\d+[.)]|[-*])\s+/, '')
    .replace(/[).:,;!]+$/, '')
    .trim()
    .toLowerCase();
  if (!clean) return undefined;
  const hit = options.find((o) => o.id.toLowerCase() === clean || o.label.toLowerCase() === clean);
  if (hit) return hit;
  if (/^\d+$/.test(clean) && !options.some((o) => /^\d+$/.test(o.id))) {
    const n = Number(clean);
    if (n >= 1 && n <= options.length) return options[n - 1];
  }
  return undefined;
}

/**
 * Reject an action that is not in a closed set before a turn is spent.
 * free-text and a missing space always pass; schema only requires kind:call
 * (the game validates args). Setup/quit stay kind:line and must not go through
 * this — the runner validates player turns only.
 */
export function validateAction(space: ActionSpace | undefined, action: Action): void {
  if (!space || space.kind === 'free-text') return;
  if (space.kind === 'keys') {
    if (action.kind !== 'key' || !space.keys.includes(action.key)) {
      throw new ActionError(
        `illegal key ${JSON.stringify(action.kind === 'key' ? action.key : actionToLine(action))}`,
        `legal keys: ${space.keys.join(' ')}`,
      );
    }
    return;
  }
  if (space.kind === 'choice') {
    if (action.kind !== 'choose' || !space.options.some((o) => o.id === action.id)) {
      throw new ActionError(
        `illegal choice ${JSON.stringify(action.kind === 'choose' ? action.id : actionToLine(action))}`,
        `legal ids: ${space.options.map((o) => o.id).join(', ')}`,
      );
    }
    return;
  }
  if (space.kind === 'schema' && action.kind !== 'call') {
    throw new ActionError(
      `schema space requires a call, got ${action.kind}`,
      'reply with one call from the schema',
    );
  }
}
