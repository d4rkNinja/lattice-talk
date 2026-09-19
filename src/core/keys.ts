/** Redis cluster hash tag so every key for a session hashes to the same slot. */
export function sessionTag(sessionId: string): string {
  return `{${sessionId}}`;
}

export function dmPair(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/** Cursor rid for a DM pair stream. */
export function dmCursorRid(pair: string): string {
  return `dm:${pair}`;
}

export function inboxCursorRid(otherAgentId: string): string {
  return `inbox:${otherAgentId}`;
}

export const keys = {
  sessionMeta(ns: string, sid: string): string {
    return `lattice:${ns}:session:${sessionTag(sid)}:meta`;
  },
  sessionAgents(ns: string, sid: string): string {
    return `lattice:${ns}:session:${sessionTag(sid)}:agents`;
  },
  presence(ns: string, sid: string, agentId: string): string {
    return `lattice:${ns}:session:${sessionTag(sid)}:presence:${agentId}`;
  },
  sessionRooms(ns: string, sid: string): string {
    return `lattice:${ns}:session:${sessionTag(sid)}:rooms`;
  },
  sessionJoin(ns: string, sid: string): string {
    return `lattice:${ns}:session:${sessionTag(sid)}:join`;
  },
  dmPartners(ns: string, sid: string, agentId: string): string {
    return `lattice:${ns}:session:${sessionTag(sid)}:dm_partners:${agentId}`;
  },
  roomMeta(ns: string, sid: string, rid: string): string {
    return `lattice:${ns}:room:${sessionTag(sid)}:${rid}:meta`;
  },
  roomMembers(ns: string, sid: string, rid: string): string {
    return `lattice:${ns}:room:${sessionTag(sid)}:${rid}:members`;
  },
  roomStream(ns: string, sid: string, rid: string): string {
    return `lattice:${ns}:stream:session:${sessionTag(sid)}:room:${rid}`;
  },
  dmStream(ns: string, sid: string, pair: string): string {
    return `lattice:${ns}:stream:session:${sessionTag(sid)}:dm:${pair}`;
  },
  cursor(ns: string, sid: string, agentId: string, rid: string): string {
    return `lattice:${ns}:cursor:${sessionTag(sid)}:${agentId}:${rid}`;
  },
  wake(ns: string, sid: string): string {
    return `lattice:${ns}:wake:${sessionTag(sid)}`;
  },
  memoryKv(ns: string, sid: string): string {
    return `lattice:${ns}:memory:${sessionTag(sid)}:kv`;
  },
  memoryNotes(ns: string, sid: string): string {
    return `lattice:${ns}:memory:${sessionTag(sid)}:notes`;
  },
  memoryMeta(ns: string, sid: string, key: string): string {
    return `lattice:${ns}:memory:${sessionTag(sid)}:meta:${key}`;
  },
};

export type KeyBuilder = typeof keys;
