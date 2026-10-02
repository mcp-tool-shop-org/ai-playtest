// providers.ts — route each chat call to the provider its seat names.
//
// The runner, player and critic all take one ChatClient and pass a model id.
// Seats are validated so a model id belongs to exactly one provider, which lets
// a single routed client stand in for all of them without changing those seams.

import type { Seat, SeatProvider } from './config.js';
import { pickJurors } from './panel.js';
import type { ChatClient } from './openrouter.js';

const providerOf = (s: Seat): SeatProvider => s.provider ?? 'openrouter';

export function createRoutedClient(seats: Seat[], clients: Partial<Record<SeatProvider, ChatClient>>): ChatClient {
  const byModel = new Map(seats.map((s) => [s.model, providerOf(s)]));
  return (req) => {
    const provider = byModel.get(req.model) ?? 'openrouter';
    const client = clients[provider];
    if (!client) return Promise.reject(new Error(`no ${provider} client for ${req.model}`));
    return client(req);
  };
}

/**
 * Providers a run will actually call: the selected players' and the jurors
 * each of them will draw. An all-local run must not demand an OpenRouter key.
 */
export function providersInUse(allSeats: Seat[], selectedIds: string[] | undefined, panelSize: number): Set<SeatProvider> {
  const players = selectedIds ? allSeats.filter((s) => selectedIds.includes(s.id)) : allSeats;
  const used = new Set<SeatProvider>();
  for (const p of players) {
    used.add(providerOf(p));
    if (panelSize > 0) for (const j of pickJurors(allSeats, p, panelSize)) used.add(providerOf(j));
  }
  return used;
}
