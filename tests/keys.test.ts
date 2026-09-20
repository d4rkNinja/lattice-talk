import { describe, expect, it } from "vitest";
import { dmCursorRid, dmPair, keys, sessionTag } from "../src/core/keys.js";

describe("key builders", () => {
  it("wraps session_id in a Redis cluster hash tag", () => {
    expect(sessionTag("team-42")).toBe("{team-42}");
    expect(keys.sessionMeta("dev", "team-42")).toBe("lattice:dev:session:{team-42}:meta");
    expect(keys.sessionMeta("dev", "team-42")).toContain("{team-42}");
  });

  it("uses the documented prefix and session-scoped paths", () => {
    const ns = "dev";
    const sid = "abc";
    expect(keys.sessionAgents(ns, sid)).toBe("lattice:dev:session:{abc}:agents");
    expect(keys.presence(ns, sid, "a1")).toBe("lattice:dev:session:{abc}:presence:a1");
    expect(keys.sessionRooms(ns, sid)).toBe("lattice:dev:session:{abc}:rooms");
    expect(keys.sessionJoin(ns, sid)).toBe("lattice:dev:session:{abc}:join");
    expect(keys.roomMeta(ns, sid, "main")).toBe("lattice:dev:room:{abc}:main:meta");
    expect(keys.roomMembers(ns, sid, "main")).toBe("lattice:dev:room:{abc}:main:members");
    expect(keys.roomStream(ns, sid, "main")).toBe(
      "lattice:dev:stream:session:{abc}:room:main",
    );
    expect(keys.dmStream(ns, sid, "a:b")).toBe("lattice:dev:stream:session:{abc}:dm:a:b");
    expect(keys.cursor(ns, sid, "a1", "main")).toBe("lattice:dev:cursor:{abc}:a1:main");
    expect(keys.memoryKv(ns, sid)).toBe("lattice:dev:memory:{abc}:kv");
    expect(keys.memoryNotes(ns, sid)).toBe("lattice:dev:memory:{abc}:notes");
    expect(keys.memoryMeta(ns, sid, "api")).toBe("lattice:dev:memory:{abc}:meta:api");
    expect(keys.dmPartners(ns, sid, "a1")).toBe(
      "lattice:dev:session:{abc}:dm_partners:a1",
    );
  });

  it("sorts DM pair keys so a:b === b:a", () => {
    expect(dmPair("b", "a")).toBe("a:b");
    expect(dmPair("a", "b")).toBe("a:b");
    expect(dmPair("frontend", "backend")).toBe("backend:frontend");
    expect(dmCursorRid("a:b")).toBe("dm:a:b");
  });
});
