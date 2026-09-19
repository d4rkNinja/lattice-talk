import type { BusDeps } from "./types.js";

export async function refreshPresence(
  deps: BusDeps,
  sessionId: string,
  agentId: string,
): Promise<void> {
  await deps.store.touchPresence(sessionId, agentId, deps.config.presenceTtlSeconds);
}

export async function clearPresence(
  deps: BusDeps,
  sessionId: string,
  agentId: string,
): Promise<void> {
  await deps.store.clearPresence(sessionId, agentId);
}
