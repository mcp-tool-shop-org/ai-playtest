import { describe, it, expect } from 'vitest';
import { stripAnsi, buildChildEnv, spawnGame } from './stdio-game.js';
import type { GameConfig } from './config.js';

const ESC = '\u001b';
const BEL = '\u0007';

describe('stripAnsi', () => {
  // The regression that started this: the OSC branch terminated on the NEXT BEL
  // anywhere in the buffer, so an ST-terminated OSC plus a later BEL deleted
  // everything between them. Measured at 46 characters of narration.
  it('does not swallow text between an ST-terminated OSC and a later BEL', () => {
    const input = `${ESC}]0;title${ESC}\\ You enter the cave.\nA bell rings!${BEL} The door opens.`;
    const out = stripAnsi(input);
    expect(out).toContain('You enter the cave.');
    expect(out).toContain('A bell rings!');
    expect(out).toContain('The door opens.');
  });

  it('strips a BEL-terminated OSC title without touching the narration after it', () => {
    // ConPTY injects exactly this into every Windows session.
    expect(stripAnsi(`${ESC}]0;C:\\node.exe${BEL}You stand in a ruined chapel.`))
      .toBe('You stand in a ruined chapel.');
  });

  // Pins the whole failure class the invisible-control-byte regex created: if
  // those literal bytes are ever normalised away, the pattern degenerates into
  // one that truncates at the first ']' and this assertion goes red.
  it('leaves bracketed game text byte-identical', () => {
    for (const s of [
      '[1] Attack  [2] Flee\nWhat do you do?',
      'HP [####------] 40%',
      'Inventory: [sword] [potion]',
      'You see a door [locked].',
    ]) {
      expect(stripAnsi(s)).toBe(s);
    }
  });

  it('removes the ESC byte for two-character sequences, not just CSI', () => {
    // ESC 7 / ESC 8 (cursor save/restore) previously survived whole, leaking
    // raw control bytes into the player's context and the written transcript.
    const out = stripAnsi(`${ESC}7HP 40/100${ESC}8`);
    expect(out).toBe('HP 40/100');
    expect(out).not.toContain(ESC);
  });

  it('strips SGR, cursor addressing and 8-bit CSI', () => {
    expect(stripAnsi(`${ESC}[31mHP${ESC}[0m 40/40`)).toBe('HP 40/40');
    expect(stripAnsi(`${ESC}[2J${ESC}[1;1HMap`)).toBe('Map');
    expect(stripAnsi('\u009b31mRED\u009b0m')).toBe('RED');
  });

  it('applies carriage returns as overwrites rather than concatenating frames', () => {
    // Terminal semantics: \r returns to column 0 and later text overwrites in
    // place, so a shorter frame leaves the tail of the longer one behind --
    // exactly what a real terminal shows. The old code concatenated the frames.
    expect(stripAnsi('Loading 10%\rLoading 99%\rLoading done')).toBe('Loading done');
    expect(stripAnsi('Loading 10%\rLoading 99%')).not.toContain('10%');
    // A shorter frame does NOT erase the tail of a longer one -- that is what a
    // real terminal shows, and pinning it keeps the overwrite honest.
    expect(stripAnsi('Searching...\rFound!')).toBe('Found!ing...');
  });

  it('preserves CRLF line endings', () => {
    expect(stripAnsi('line one\r\nline two')).toBe('line one\nline two');
  });
});

describe('buildChildEnv', () => {
  const source = {
    PATH: '/usr/bin',
    OPENROUTER_API_KEY: 'sk-or-v1-SECRET',
    ANTHROPIC_API_KEY: 'sk-ant-SECRET',
    SOME_TOKEN: 'tok',
    HOME: '/home/u',
  } as NodeJS.ProcessEnv;

  it('withholds the provider credential from the game by default', () => {
    const env = buildChildEnv({}, source, false);
    expect(env.OPENROUTER_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.SOME_TOKEN).toBeUndefined();
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/u');
  });

  it('still passes explicitly resolved values through', () => {
    const env = buildChildEnv({ ANTHROPIC_API_KEY: 'sk-or-v1-SECRET' }, source, false);
    expect(env.ANTHROPIC_API_KEY).toBe('sk-or-v1-SECRET');
  });

  it('inherits everything only when inheritEnv is set', () => {
    expect(buildChildEnv({}, source, true).OPENROUTER_API_KEY).toBe('sk-or-v1-SECRET');
  });

  it('always forces colour off', () => {
    const env = buildChildEnv({}, source, false);
    expect(env.FORCE_COLOR).toBe('0');
    expect(env.NO_COLOR).toBe('1');
  });
});

function cfg(over: Partial<GameConfig>): GameConfig {
  return {
    command: process.execPath,
    args: ['-e', 'process.stdout.write("Choose:\\n> ")'],
    cwd: process.cwd(),
    env: {},
    promptPatterns: ['>\\s*$'],
    promptQuietMs: 100,
    idleQuietMs: 1500,
    screenTimeoutMs: 8000,
    quitInputs: ['quit'],
    ...over,
  };
}

describe('spawnGame', () => {
  it('reaches prompt even when the game chatters on stderr', async () => {
    // stderr used to bump the same lastByteAt as stdout, so a stderr-logging
    // game pinned `quiet` near zero and could never reach prompt or idle:
    // measured 3063ms timeout every turn where 220ms prompt was correct.
    const g = spawnGame(cfg({
      args: ['-e', `process.stdout.write("Choose:\\n> ");setInterval(()=>process.stderr.write("tick\\n"),20)`],
    }), {});
    const screen = await g.nextScreen();
    g.kill();
    expect(screen.reason).toBe('prompt');
    expect(screen.text).toContain('Choose:');
  }, 15000);

  it('reports a command that cannot be started instead of showing an empty screen', async () => {
    const g = spawnGame(cfg({ command: 'definitely-not-a-real-command-xyz', args: [] }), {});
    const screen = await g.nextScreen();
    g.kill();
    expect(screen.reason).toBe('exit');
    expect(g.spawnError).not.toBeNull();
    expect(g.stderr).toContain('[spawn error]');
  }, 15000);

  it('survives writing to a game that has already exited', async () => {
    const g = spawnGame(cfg({ args: ['-e', 'process.exit(0)'] }), {});
    await g.nextScreen();
    // Previously an unhandled EPIPE on child.stdin took down the whole runner,
    // killing every parallel seat with it.
    expect(() => { g.send('anything'); g.send('again'); }).not.toThrow();
  }, 15000);

  it('does not corrupt multi-byte characters split across chunk boundaries', async () => {
    const g = spawnGame(cfg({
      args: ['-e', `const s=Buffer.from("HP \\u250c\\u2500\\u2510 \\u2694 done\\n> ");for(const b of s){process.stdout.write(Buffer.from([b]))}`],
    }), {});
    const screen = await g.nextScreen();
    g.kill();
    expect(screen.text).not.toContain('\ufffd');
    expect(screen.text).toContain('\u250c\u2500\u2510');
  }, 15000);

  it('reports timeout when the game prints one line then goes silent', async () => {
    // Gate: deleting `if (now - started > cfg.screenTimeoutMs) return resolveScreen(take('timeout'))`
    // makes this RED (reason becomes 'idle' after idleQuietMs, or the poll loop never returns).
    const g = spawnGame(cfg({
      args: ['-e', 'process.stdout.write("one line then silence\\n"); setInterval(() => {}, 1e9)'],
      promptPatterns: ['NEVER_MATCH_PROMPT_xyzzy\\s*$'],
      promptQuietMs: 50,
      idleQuietMs: 10_000,
      screenTimeoutMs: 400,
    }), {});
    try {
      const screen = await g.nextScreen();
      expect(screen.reason).toBe('timeout');
      expect(screen.text).toContain('one line then silence');
    } finally {
      g.kill();
    }
  }, 2000);

  it('reports idle when output is quiet and no prompt pattern matches', async () => {
    // Gate: deleting `if (quiet >= cfg.idleQuietMs) return resolveScreen(take('idle'))`
    // makes this RED (reason becomes 'timeout' at screenTimeoutMs).
    const g = spawnGame(cfg({
      args: ['-e', 'process.stdout.write("You stand in a ruined chapel.\\nExits: nave.\\n"); setInterval(() => {}, 1e9)'],
      promptPatterns: ['NEVER_MATCH_PROMPT_xyzzy\\s*$'],
      promptQuietMs: 50,
      idleQuietMs: 200,
      screenTimeoutMs: 8000,
    }), {});
    try {
      const screen = await g.nextScreen();
      expect(screen.reason).toBe('idle');
      expect(screen.text).toContain('ruined chapel');
    } finally {
      g.kill();
    }
  }, 2000);
});
