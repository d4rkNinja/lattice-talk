import type { LatticeMessage } from "../core/types.js";

/**
 * Pure helpers for the room feed — grouping and visibility filtering.
 * Kept render-free so the logic is unit-testable without a TTY.
 */

export interface MessageGroup {
  /** Stream id of the first message — stable React key. */
  key: string;
  from: string;
  messages: LatticeMessage[];
}

/**
 * Merge runs of consecutive messages from the same sender into one group.
 * A sender change always breaks the group; ordering is preserved.
 */
export function groupMessages(messages: LatticeMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  for (const m of messages) {
    const last = groups[groups.length - 1];
    if (last && last.from === m.from) {
      last.messages.push(m);
    } else {
      groups.push({ key: m.id, from: m.from, messages: [m] });
    }
  }
  return groups;
}

export interface FeedFilter {
  /** Agent ids whose messages are hidden ("paused"). */
  paused?: ReadonlySet<string>;
  /** When set, only this agent's messages are shown. Wins over paused. */
  focus?: string | null;
}

export function filterMessages(
  messages: LatticeMessage[],
  { paused, focus }: FeedFilter,
): LatticeMessage[] {
  if (focus) return messages.filter((m) => m.from === focus);
  if (!paused || paused.size === 0) return messages;
  return messages.filter((m) => !paused.has(m.from));
}
