import { describe, expect, it } from "vitest";
import { memoryList, memorySet } from "../src/core/memory.js";
import { MemoryStore } from "../src/core/memory-store.js";
import { joinSession, listPeers, sessionInfo } from "../src/core/session.js";
import { makeDeps } from "./helpers.js";

describe("paginated lists", () => {
  it("memory_list pages sorted keys and does not dump the full set", async () => {
    const store = new MemoryStore("page");
    const deps = makeDeps(store);
    await joinSession(deps, { session_id: "s1", role: "fe", agent_id: "fe" });

    for (let i = 0; i < 60; i += 1) {
      const key = `k${String(i).padStart(2, "0")}`;
      await memorySet(deps, { key, value: `v${i}` });
    }

    const first = await memoryList(deps, { limit: 10 });
    expect(first.keys).toHaveLength(10);
    expect(first.keys[0]).toBe("k00");
    expect(first.truncated).toBe(true);
    expect(first.next_cursor).toBe("k09");

    const second = await memoryList(deps, { cursor: first.next_cursor, limit: 10 });
    expect(second.keys[0]).toBe("k10");
    expect(second.keys).toHaveLength(10);

    const fullDefault = await memoryList(deps, {});
    expect(fullDefault.keys).toHaveLength(50);
    expect(fullDefault.truncated).toBe(true);

    const capped = await memoryList(deps, { limit: 999 });
    expect(capped.keys.length).toBeLessThanOrEqual(200);
  });

  it("list_peers pages sorted agent ids", async () => {
    const store = new MemoryStore("page");
    const session = "peers-1";
    const first = makeDeps(store);
    await joinSession(first, { session_id: session, role: "a", agent_id: "agent-00" });

    for (let i = 1; i < 12; i += 1) {
      const deps = makeDeps(store);
      await joinSession(deps, {
        session_id: session,
        role: "peer",
        agent_id: `agent-${String(i).padStart(2, "0")}`,
      });
    }

    const page1 = await listPeers(first, { session_id: session, limit: 5 });
    expect(page1.peer_count).toBe(12);
    expect(page1.peers).toHaveLength(5);
    expect(page1.peers[0]?.agent_id).toBe("agent-00");
    expect(page1.truncated).toBe(true);
    expect(page1.next_cursor).toBe("agent-04");

    const page2 = await listPeers(first, {
      session_id: session,
      cursor: page1.next_cursor,
      limit: 5,
    });
    expect(page2.peers[0]?.agent_id).toBe("agent-05");
    expect(page2.truncated).toBe(true);
  });

  it("session_info caps rooms", async () => {
    const store = new MemoryStore("page");
    const deps = makeDeps(store);
    await joinSession(deps, { session_id: "s1", role: "fe", agent_id: "fe" });
    const info = await sessionInfo(deps, { session_id: "s1" });
    expect(info.rooms).toContain("main");
    expect(info.rooms_truncated).toBe(false);
    expect(info.rooms.length).toBeLessThanOrEqual(200);
  });
});
