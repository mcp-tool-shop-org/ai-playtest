import type { SiteConfig } from '@mcptoolshop/site-theme';

export const config: SiteConfig = {
  title: 'ai-playtest',
  description:
    'Family-diverse AI playtesting for turn-based games. Model players drive a game; a jury from other families judges the transcript; the report says how much of the game they actually saw.',
  logoBadge: 'AP',
  brandName: 'ai-playtest',
  repoUrl: 'https://github.com/mcp-tool-shop-org/ai-playtest',
  footerText:
    'MIT Licensed — built by <a href="https://mcp-tool-shop.github.io/" style="color:var(--color-muted);text-decoration:underline">MCP Tool Shop</a>',

  hero: {
    badge: 'Private 0.1.0 · three drivers · author-off jury · MIT',
    headline: 'Play the game',
    headlineAccent: 'with other families.',
    description:
      'One playthrough by one person tells you what one person saw. Five families playing the same forty turns tell you what the world does. A seat never scores its own play.',
    primaryCta: { href: '#run', label: 'See a run' },
    secondaryCta: { href: 'handbook/', label: 'Read the Handbook' },
    previews: [
      {
        label: 'Check',
        code: `node dist/cli.js check game.playtest.json
# no API key. exits 2 on a bad config.`,
      },
      {
        label: 'Run',
        code: `export OPENROUTER_API_KEY=...
node dist/cli.js run game.playtest.json --label proof-01 --turns 8
# --serial: one RPC client, reset() between seats`,
      },
      {
        label: 'Report',
        code: `runs/proof-01/REPORT.md
runs/proof-01/REPORT.json   # kind: single-run-report
runs/proof-01/mistral/transcript.txt`,
      },
    ],
  },

  sections: [
    {
      kind: 'features',
      id: 'shape',
      title: 'What you get',
      subtitle: 'A transcript, a jury, and a sampling qualifier — not a score you cannot defend.',
      features: [
        {
          title: 'Three drivers, one observation',
          desc: 'stdio for line games, pty for a rendered TUI grid, rpc for Godot / Unreal / anything that can speak newline JSON. text is always present. pixels are an attachment.',
        },
        {
          title: 'Author off the jury',
          desc: 'Default one author-off seat (panelSize 1). Extra jurors flag disagreement; they are not averaged into a stronger score. Kohli 2026: n_eff 2.18. Budget moved from judges to runs.',
        },
        {
          title: 'Deterministic floor',
          desc: 'Absorbing-SCC (Tarjan, kind=review, never a trap proof), ignored inputs, optional parser/victory/death regexes, no-progress windows, entity leads, state-gated HP/inventory when the engine sent state.',
        },
        {
          title: 'A report a human can read',
          desc: '`!` is a juror split. H(a) is action entropy in bits. Thin on a short varied session is a sample-size limit, not “never reached the content.” REPORT.json sits next to REPORT.md.',
        },
      ],
    },
    {
      kind: 'features',
      id: 'honest',
      title: 'Honesty rules',
      subtitle: 'The product is the report. The report must not flatter.',
      features: [
        {
          title: 'No self-score',
          desc: 'pickJurors returns empty rather than hand the transcript back to its author. The playing seat’s reading is testimony.',
        },
        {
          title: 'n=3 is descriptive',
          desc: '`--runs 3` cannot reach p<0.05 (floor 2/2^n = 0.25). First n that can clear α=0.05 is 6. Do not bootstrap.',
        },
        {
          title: 'Empty degraded ≠ dead',
          desc: 'A panel that sat no jurors is not a fail-closed majority over an empty set. The report says so.',
        },
        {
          title: 'Config is a shell script',
          desc: 'game.command is spawn. OPENROUTER_API_KEY does not go to the child unless inheritEnv. No telemetry.',
        },
      ],
    },
    {
      kind: 'code-cards',
      id: 'run',
      title: 'A run',
      cards: [
        {
          title: 'From a clone (not npm — still private)',
          code: `git clone https://github.com/mcp-tool-shop-org/ai-playtest
cd ai-playtest && npm ci && npm run build
export OPENROUTER_API_KEY=...
node dist/cli.js run path/to/game.playtest.json --label smoke --turns 8`,
        },
        {
          title: 'RPC, several seats, one engine',
          code: `node dist/cli.js run godot.playtest.json --label rpc --serial
# start() once, reset() between seats, stop() once
# missing reset → that next seat fails E_RESET`,
        },
        {
          title: 'Rebuild the page from disk',
          code: `node dist/cli.js report game.playtest.json --label smoke
# writes REPORT.md + REPORT.json
# refuses if reportFormat on disk is newer than this tool`,
        },
      ],
    },
  ],
};
