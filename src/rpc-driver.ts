// rpc-driver.ts — observe a game that can describe itself.
//
// This is the strongest channel the tool has, and the one worth building a game
// against. A game that hands over structured state does not need the harness to
// guess when a turn began, does not need a regex to find the prompt, and can say
// exactly which actions are legal — so an illegal action is rejected before a
// turn is spent on it. The evidence is lopsided: Voyager, still the strongest
// open-ended game agent, drove a structured JS API and outperformed pixel
// approaches by 3.3x on unique items and 15.3x on tech-tree milestones.
//
// The transport is newline-delimited JSON over TCP, deliberately. It needs no
// dependency on either side: Godot has StreamPeerTCP and JSON in core, Unreal
// has FSocket and FJsonSerializer, and anything else has a socket. A WebSocket
// would need a library on at least one side and buys nothing here.
//
// The protocol is request/response, which is also the pause protocol. The game
// answers `act` only when it is ready for the next input, so "whose turn is it"
// is never inferred — it is the shape of the exchange. For a real-time game the
// handler pauses the world, applies the action, runs N frames, and only then
// replies; LLM latency (roughly 0.5-2s per turn) makes any other arrangement
// unplayable.
//
// Two methods, both taking and returning JSON:
//
//   -> {"id":1,"method":"observe"}
//   <- {"id":1,"result":{"text":"...","state":{...},"actions":{...},"done":false}}
//
//   -> {"id":2,"method":"act","params":{"kind":"choose","id":"2"}}
//   <- {"id":2,"result":{"text":"...","state":{...},"actions":{...},"done":false}}
//
// A `result` that is missing `text` is filled from `state`, so a game that only
// serialises state still works — but a game that writes its own prose gives the
// player model much better material, and should.

import { createConnection, type Socket } from 'node:net';
import type { Driver, Observation, Action, ActionSpace, ReadyReason } from './driver.js';

export class RpcDriverError extends Error {
  readonly code = 'E_RPC_DRIVER';
  constructor(message: string, readonly hint: string) {
    super(message);
  }
}

export type RpcDriverOptions = {
  host?: string;
  port: number;
  /** How long to wait for the game to accept a connection. */
  connectTimeoutMs?: number;
  /** How long to wait for one reply before calling the turn a stall. */
  requestTimeoutMs?: number;
};

type RpcResult = {
  text?: string;
  state?: unknown;
  actions?: ActionSpace;
  image?: { mime: string; base64: string };
  done?: boolean;
  exitCode?: number | null;
  reason?: ReadyReason;
};

export async function createRpcDriver(opts: RpcDriverOptions): Promise<Driver> {
  const host = opts.host ?? '127.0.0.1';
  const connectTimeoutMs = opts.connectTimeoutMs ?? 10_000;
  const requestTimeoutMs = opts.requestTimeoutMs ?? 120_000;

  const socket: Socket = await new Promise((resolve, reject) => {
    const s = createConnection({ host, port: opts.port });
    const timer = setTimeout(() => {
      s.destroy();
      reject(new RpcDriverError(
        `no game listening on ${host}:${opts.port} after ${connectTimeoutMs}ms`,
        'start the game with its playtest bridge enabled before running the playtest',
      ));
    }, connectTimeoutMs);
    s.once('connect', () => { clearTimeout(timer); resolve(s); });
    s.once('error', (err) => {
      clearTimeout(timer);
      reject(new RpcDriverError(
        `cannot reach the game at ${host}:${opts.port}: ${err.message}`,
        'check the port matches the bridge, and that the game is running',
      ));
    });
  });

  socket.setEncoding('utf8');
  let buffer = '';
  let closed = false;
  let diagnostics = '';
  let nextId = 1;
  const pending = new Map<number, { resolve: (r: RpcResult) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();

  socket.on('data', (chunk: string) => {
    buffer += chunk;
    // Newline-delimited: everything before the last newline is complete
    // messages, and a partial tail waits for more bytes.
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let msg: { id?: number; result?: RpcResult; error?: { message?: string }; method?: string; params?: unknown };
      try {
        msg = JSON.parse(line);
      } catch {
        diagnostics += `[rpc] non-JSON line from game: ${line.slice(0, 200)}\n`;
        continue;
      }
      // An unsolicited "log" notification lets a game report its own diagnostics
      // without polluting the observation the player sees.
      if (msg.method === 'log') { diagnostics += `${JSON.stringify(msg.params)}\n`; continue; }
      if (typeof msg.id !== 'number') continue;
      const waiter = pending.get(msg.id);
      if (!waiter) continue;
      pending.delete(msg.id);
      clearTimeout(waiter.timer);
      if (msg.error) {
        waiter.reject(new RpcDriverError(
          `the game reported an error: ${msg.error.message ?? 'unknown'}`,
          'this is the game\'s own error, not the harness\'s — check the bridge handler',
        ));
      } else {
        waiter.resolve(msg.result ?? {});
      }
    }
  });
  socket.on('close', () => {
    closed = true;
    // Rejecting outstanding calls prevents a closed socket from hanging a seat
    // until the request timeout, which on a five-seat run is five stalls.
    for (const [, w] of pending) {
      clearTimeout(w.timer);
      w.reject(new RpcDriverError('the game closed the connection', 'the game exited or crashed mid-session; check its own logs'));
    }
    pending.clear();
  });
  socket.on('error', (err) => { diagnostics += `[rpc] socket error: ${err.message}\n`; });

  function call(method: string, params?: unknown): Promise<RpcResult> {
    if (closed) {
      return Promise.reject(new RpcDriverError('the game connection is closed', 'the game exited; nothing more can be observed'));
    }
    const id = nextId++;
    return new Promise<RpcResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new RpcDriverError(
          `the game did not answer ${method} within ${requestTimeoutMs}ms`,
          'the game may be waiting on something, or its bridge handler never replied',
        ));
      }, requestTimeoutMs);
      pending.set(id, { resolve, reject, timer });
      socket.write(JSON.stringify({ id, method, ...(params === undefined ? {} : { params }) }) + '\n');
    });
  }

  function toObservation(r: RpcResult): Observation {
    // `text` is mandatory in an Observation because it is the channel every
    // player model reads. A game that sends only state gets a serialisation
    // rather than an error -- but it is a worse brief, and that is worth
    // knowing when reading a thin report.
    const text = typeof r.text === 'string' && r.text.length > 0
      ? r.text
      : r.state !== undefined
        ? JSON.stringify(r.state, null, 2)
        : '';
    return {
      text,
      state: r.state,
      image: r.image,
      actions: r.actions,
      reason: r.reason ?? (r.done ? 'exit' : 'sentinel'),
      done: r.done === true,
      exitCode: r.exitCode ?? null,
    };
  }

  return {
    modality: 'rpc',
    get diagnostics() { return diagnostics; },
    async start() { return toObservation(await call('observe')); },
    async step(action: Action) { return toObservation(await call('act', action)); },
    async stop() {
      if (!closed) {
        try { await call('quit'); } catch { /* the game may simply close on quit */ }
        socket.destroy();
        closed = true;
      }
    },
  };
}
