import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { createRpcDriver, RpcDriverError } from '../src/rpc-driver.js';

const FIXTURE = resolve(__dirname, 'fixtures', 'rpc-game.mjs');
let child: ChildProcess | undefined;

afterEach(() => { child?.kill(); child = undefined; });

/** Start the fixture engine and wait for it to announce its port. */
function startGame(): Promise<number> {
  return new Promise((res, rej) => {
    child = spawn(process.execPath, [FIXTURE, '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => rej(new Error('fixture never announced a port')), 10_000);
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (d: string) => {
      out += d;
      const m = out.match(/PLAYTEST_BRIDGE_PORT=(\d+)/);
      if (m) { clearTimeout(timer); res(Number(m[1])); }
    });
    child.on('error', rej);
  });
}

describe('rpc driver', () => {
  it('observes structured state and a declared action space', async () => {
    const d = await createRpcDriver({ port: await startGame() });
    const obs = await d.start();
    expect(obs.text).toContain('Chapel Nave');
    expect(obs.text).toContain('HP 40/100');
    expect(obs.state).toMatchObject({ room: 'Chapel Nave', hp: 40, exits: ['nave', 'alcove'] });
    // The game says what is legal, so the runner can reject a bad action before
    // spending a turn on it -- the thing a text game cannot tell you.
    expect(obs.actions).toMatchObject({ kind: 'choice' });
    expect((obs.actions as any).options.map((o: any) => o.id)).toEqual(['attack', 'flee', 'look']);
    // Turn-taking is the shape of the exchange, not a guess about quiet time.
    expect(obs.reason).toBe('sentinel');
    expect(obs.done).toBe(false);
    await d.stop();
  }, 20000);

  it('applies actions and reflects them in state', async () => {
    const d = await createRpcDriver({ port: await startGame() });
    await d.start();
    const after = await d.step({ kind: 'choose', id: 'attack' });
    expect(after.state).toMatchObject({ hp: 30, turn: 1 });
    expect(after.text).toContain('HP 30/100');
    const moved = await d.step({ kind: 'choose', id: 'flee' });
    expect(moved.state).toMatchObject({ room: 'Alcove' });
    await d.stop();
  }, 20000);

  it('serialises state into text when the game sends no prose', async () => {
    // text is mandatory on an Observation because it is the channel the player
    // model reads; a state-only game gets a serialisation rather than an error.
    const d = await createRpcDriver({ port: await startGame() });
    const obs = await d.start();
    expect(typeof obs.text).toBe('string');
    expect(obs.text.length).toBeGreaterThan(0);
    await d.stop();
  }, 20000);

  it('surfaces a game-side error as a coded error naming the game as the source', async () => {
    const d = await createRpcDriver({ port: await startGame() });
    await d.start();
    await expect(d.step({ kind: 'choose', id: 'boom' })).rejects.toMatchObject({ code: 'E_RPC_DRIVER' });
    await expect(d.step({ kind: 'choose', id: 'boom' })).rejects.toThrow(/the game reported an error/);
    await d.stop();
  }, 20000);

  it('fails fast with an actionable hint when nothing is listening', async () => {
    // Port 1 is privileged and never a game; connect fails immediately.
    await expect(createRpcDriver({ port: 1, connectTimeoutMs: 3000 }))
      .rejects.toMatchObject({ code: 'E_RPC_DRIVER' });
  }, 20000);

  it('does not hang a seat when the game stops answering', async () => {
    const d = await createRpcDriver({ port: await startGame(), requestTimeoutMs: 500 });
    await d.start();
    await expect(d.step({ kind: 'call', name: 'silent' } as any)).rejects.toThrow(/did not answer/);
    await d.stop();
  }, 20000);

  it('reports the connection closing rather than waiting out the timeout', async () => {
    const d = await createRpcDriver({ port: await startGame(), requestTimeoutMs: 30_000 });
    await d.start();
    const pending = d.step({ kind: 'call', name: 'silent' } as any);
    child!.kill();
    // A closed socket must reject immediately; waiting the full timeout on a
    // five-seat run would mean five simultaneous stalls.
    await expect(pending).rejects.toThrow(/closed the connection/);
  }, 20000);
});

describe('a full playtest through the rpc driver', () => {
  it('plays, critiques and reports against an engine that describes itself', async () => {
    const { validateConfig } = await import('../src/config.js');
    const { runAll } = await import('../src/run.js');
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const port = await startGame();
    const dir = await mkdtemp(join(tmpdir(), 'ai-playtest-rpc-'));
    try {
      const cfg = validateConfig({
        name: 'rpc game',
        // No game.command and no promptPatterns: the rpc driver attaches to a
        // running game and the game says when it is ready.
        driver: { kind: 'rpc', port, requestTimeoutMs: 5000 },
        seats: [{ id: 'a', family: 'alpha', model: 'fake/alpha' }],
        turns: 3,
        persona: 'You are a cautious scout who wants to find out what is in the dark.',
        criteria: [{ id: 'reacts', check: 'the world changed in response to an action' }],
        runsDir: dir,
      }, dir);

      const client: any = async (req: any) => req.json
        ? JSON.stringify({ alive: true, summary: 's', criteria: [{ id: 'reacts', met: true, evidence: 'hp fell', turn: 1 }], highlights: [], deadSpots: [], confusions: [], wouldPlayAgain: true })
        : 'attack';

      const [r] = await runAll(cfg, { label: 'rpc', client, parallel: false });
      expect(r.turnsPlayed).toBe(3);
      expect(r.critique?.alive).toBe(true);
      // The state the engine reported actually reached the transcript.
      const text = r.history.map((h) => h.screen).join('\n');
      expect(text).toContain('Chapel Nave');
      expect(text).toContain('HP 10/100');
      expect(r.coverage.turns).toBe(3);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30000);
});
