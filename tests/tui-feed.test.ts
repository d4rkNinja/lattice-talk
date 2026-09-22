import { describe, expect, it } from "vitest";
import { RuntimeContext } from "../src/core/context.js";
import { MemoryStore } from "../src/core/memory-store.js";
import { tellAgent } from "../src/core/messages.js";
import { joinSession } from "../src/core/session.js";
import type { LatticeMessage } from "../src/core/types.js";
import {
  DM_FEED_ID,
  pollDmMessages,
  subscribeDmFeed,
  type BusHandle,
} from "../src/tui/bus.js";
import { filterMessages, groupMessages } from "../src/tui/feed.js";
import { makeDeps, testConfig } from "./helpers.js";

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

describe("dm feed (dashboard)", () => {
  function makeBus(store: MemoryStore): BusHandle {
    const config = testConfig();
    return {
      store,
      config,
      deps: { store, config, ctx: new RuntimeContext() },
      close: () => store.close(),
    };
  }

  it("merges every pair stream, namespaces ids, and is cursor-safe", async () => {
    const store = new MemoryStore("tui-dm");
    const bus = makeBus(store);
    const a = makeDeps(store);
    const b = makeDeps(store);
    const c = makeDeps(store);
    await joinSession(a, { session_id: "s1", agent_id: "aa", role: "be" });
    await joinSession(b, { session_id: "s1", agent_id: "bb", role: "fe" });
    await joinSession(c, { session_id: "s1", agent_id: "cc", role: "ops" });

    await tellAgent(a, { session_id: "s1", to_agent_id: "bb", body: "hi bb" });
    await tellAgent(a, { session_id: "s1", to_agent_id: "cc", body: "hi cc" });

    const cursors = new Map<string, string>();
    const fresh = await pollDmMessages(bus, "s1", cursors);
    expect(fresh.map((m) => m.body).sort()).toEqual(["hi bb", "hi cc"]);
    expect(fresh.every((m) => typeof m.to === "string")).toBe(true);
    // Stream ids repeat across pairs — namespacing keeps feed keys unique.
    expect(new Set(fresh.map((m) => m.id)).size).toBe(2);
    // Cursors advanced: a second poll returns nothing.
    expect(await pollDmMessages(bus, "s1", cursors)).toHaveLength(0);
  });

  it("subscribeDmFeed wakes on a DM to any agent and stops cleanly", async () => {
    const store = new MemoryStore("tui-dm-sub");
    const bus = makeBus(store);
    const a = makeDeps(store);
    const b = makeDeps(store);
    await joinSession(a, { session_id: "s1", agent_id: "aa", role: "be" });
    await joinSession(b, { session_id: "s1", agent_id: "bb", role: "fe" });

    let wakes = 0;
    const unsub = await subscribeDmFeed(bus, "s1", () => {
      wakes += 1;
    });
    await tellAgent(a, { session_id: "s1", to_agent_id: "bb", body: "x" });
    expect(wakes).toBe(1);
    await unsub();
    await tellAgent(a, { session_id: "s1", to_agent_id: "bb", body: "y" });
    expect(wakes).toBe(1);
  });

  it("dm feed id can never collide with a room name", () => {
    // assertId excludes ':' from public ids, so "dm:all" is unclaimable.
    expect(DM_FEED_ID).toContain(":");
  });
});
