import type { Store } from "./store.js";

/**
 * Best-effort wake-up publish. Streams are the source of truth: if the
 * publish fails, the payload is still durably stored and a waiting reader
 * just falls back to its timeout or next poll — so notify failures must
 * never fail the write that produced them.
 */
export async function publishNotify(
  store: Store,
  channel: string,
  payload: Record<string, string>,
): Promise<void> {
  try {
    await store.publish(channel, JSON.stringify(payload));
  } catch {
    // dropped wake-up is harmless
  }
}

/**
 * Resolve on the first message on any of `channels`, or after `timeoutMs`.
 * Always unsubscribes. Resolves false on timeout or subscribe failure.
 *
 * `recheck` runs once after the subscription is active and before waiting —
 * it closes the race where an event lands between the caller's initial check
 * and the subscribe completing. Returning true resolves immediately.
 */
export async function waitForNotify(
  store: Store,
  channels: string[],
  timeoutMs: number,
  recheck?: () => Promise<boolean>,
): Promise<boolean> {
  if (channels.length === 0 || timeoutMs <= 0) return false;
  let wake!: () => void;
  const woke = new Promise<void>((resolve) => {
    wake = resolve;
  });
  let unsub: (() => Promise<void>) | undefined;
  try {
    unsub = await store.subscribe(channels, () => wake());
  } catch {
    return false;
  }
  try {
    if (recheck && (await recheck())) return true;
    const timer = new Promise<false>((resolve) => setTimeout(() => resolve(false), timeoutMs));
    const hit = await Promise.race([woke.then(() => true as const), timer]);
    return hit;
  } finally {
    await unsub();
  }
}
