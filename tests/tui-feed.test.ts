import { describe, expect, it } from "vitest";
import type { LatticeMessage } from "../src/core/types.js";
import { filterMessages, groupMessages } from "../src/tui/feed.js";

function msg(id: string, from: string, body = id): LatticeMessage {
  return { id, from, role: "r", harness: "h", kind: "chat", body, ts: "2026-01-01T00:00:00Z" };
}

describe("groupMessages", () => {
  it("merges consecutive messages from the same sender", () => {
    const groups = groupMessages([
      msg("1-0", "a"),
      msg("2-0", "a"),
      msg("3-0", "b"),
      msg("4-0", "a"),
    ]);
    expect(groups.map((g) => [g.from, g.messages.length])).toEqual([
      ["a", 2],
      ["b", 1],
      ["a", 1],
    ]);
  });

  it("keys each group by its first message id", () => {
    const groups = groupMessages([msg("5-0", "a"), msg("6-0", "a")]);
    expect(groups[0].key).toBe("5-0");
  });

  it("returns an empty list for an empty feed", () => {
    expect(groupMessages([])).toEqual([]);
  });
});

describe("filterMessages", () => {
  const feed = [msg("1-0", "a"), msg("2-0", "b"), msg("3-0", "a"), msg("4-0", "c")];

  it("passes everything through with no filters", () => {
    expect(filterMessages(feed, {})).toHaveLength(4);
  });

  it("hides paused agents", () => {
    const out = filterMessages(feed, { paused: new Set(["a"]) });
    expect(out.map((m) => m.from)).toEqual(["b", "c"]);
  });

  it("focus shows only one agent", () => {
    const out = filterMessages(feed, { focus: "a" });
    expect(out.map((m) => m.id)).toEqual(["1-0", "3-0"]);
  });

  it("focus wins over pause", () => {
    const out = filterMessages(feed, { focus: "a", paused: new Set(["a", "b"]) });
    expect(out.map((m) => m.id)).toEqual(["1-0", "3-0"]);
  });
});
