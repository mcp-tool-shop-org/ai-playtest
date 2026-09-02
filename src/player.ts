// player.ts — a model in the player's chair. It sees the screen, remembers a few
// turns, and answers with ONE line the game can read. It is briefed on goals
// and register only; the mechanics under test are never named to it.

import type { ChatClient, ChatMessage } from './openrouter.js';

export type TurnRecord = { turn: number; screen: string; input: string; reason: string; ms: number };

export const PLAYER_SYSTEM_PREFIX = `You are playing a text game through its terminal. Each message shows what the game printed since your last input. Reply with exactly ONE line: the next thing you type into the game. No quotes, no commentary, no markdown, no thinking, no explanation -- only the input line. When the game shows a numbered menu, answer with the number alone. When it asks for a number, give a bare number. When it asks a yes/no question, answer y or n. Otherwise type what a player would type: a short command or a sentence. If it lists commands, you may use them. Never repeat the same input more than twice in a row.`;

export function sanitizeInput(raw: string): string {
  let s = raw.trim();
  // strip code fences / quotes a model may wrap the line in
  s = s.replace(/^```[a-z]*\s*/i, '').replace(/```$/, '').trim();
  s = s.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  s = s.replace(/^\[[A-Z]+\]\s*/, '').replace(/^[>$]\s*/, '');
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")) || (s.startsWith('`') && s.endsWith('`'))) s = s.slice(1, -1).trim();
  if (s.length > 200) s = s.slice(0, 200);
  return s.length > 0 ? s : 'look';
}

export function buildPlayerMessages(persona: string, history: TurnRecord[], screen: string, memoryTurns: number, screenChars: number): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: 'system', content: `${PLAYER_SYSTEM_PREFIX}\n\nWho you are and what you want:\n${persona}` }];
  for (const t of history.slice(-memoryTurns)) {
    messages.push({ role: 'user', content: clip(t.screen, screenChars) });
    messages.push({ role: 'assistant', content: t.input });
  }
  messages.push({ role: 'user', content: clip(screen, screenChars) });
  return messages;
}

function clip(s: string, max: number): string {
  const t = s.trim();
  return t.length <= max ? t : `[...${t.length - max} earlier characters trimmed...]\n${t.slice(-max)}`;
}

export async function chooseInput(client: ChatClient, model: string, persona: string, history: TurnRecord[], screen: string, opts: { memoryTurns: number; screenChars: number; temperature: number }): Promise<string> {
  const raw = await client({
    model,
    messages: buildPlayerMessages(persona, history, screen, opts.memoryTurns, opts.screenChars),
    maxTokens: 60,
    temperature: opts.temperature,
  });
  return sanitizeInput(raw);
}
