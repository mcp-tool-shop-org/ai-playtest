import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadProfile, saveProfile, writeProfileReport, personaLabel } from './profile-report.js';
import { resolveProfile } from './personas.js';
import { ReportError } from './report.js';

let runs: string;
beforeEach(async () => { runs = await mkdtemp(join(tmpdir(), 'ai-playtest-profile-')); });
afterEach(async () => { await rm(runs, { recursive: true, force: true }); });

describe('profile report on disk', () => {
  it('round-trips the resolved profile, and has none for a plain run', async () => {
    const p = resolveProfile({ profile: 'player', only: ['reader'] });
    expect(await loadProfile(runs, 'L')).toBeNull();
    await saveProfile(runs, 'L', p);
    expect(await loadProfile(runs, 'L')).toEqual(p);
  });

  it('refuses a damaged profile.json with a hint', async () => {
    await mkdir(join(runs, 'L'), { recursive: true });
    await writeFile(join(runs, 'L', 'profile.json'), '{nope');
    await expect(loadProfile(runs, 'L')).rejects.toBeInstanceOf(ReportError);
  });

  it('reports a persona that never ran, and a seat without a transcript, as no signal', async () => {
    const p = resolveProfile({ profile: 'player', only: ['reader', 'tinkerer'] });
    const seatDir = join(runs, personaLabel('L', 'reader'), 'a');
    await mkdir(seatDir, { recursive: true });
    await writeFile(join(seatDir, 'meta.json'), JSON.stringify({ seat: { id: 'a', family: 'f', model: 'm' }, turnsPlayed: 3, endedBy: 'turns' }));
    const { path, result } = await writeProfileReport('G', runs, 'L', p);
    const v = Object.fromEntries(result.personas.map((x) => [x.id, [x.verdict, x.seats]]));
    expect(v).toEqual({ control: ['baseline', 0], reader: ['no-signal', 1], tinkerer: ['no-signal', 0] });
    expect(await readFile(path, 'utf8')).toContain('0 of 2 personas played distinctly');
    expect(JSON.parse(await readFile(join(runs, 'L', 'PERSONAS.json'), 'utf8')).kind).toBe('persona-profile');
  });
});
