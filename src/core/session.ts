import { randomUUID } from "node:crypto";
import { safeEqual, sha256Hex } from "./crypto.js";
import { UserError } from "./errors.js";
import { assertBoundedText, optionalId } from "./ids.js";
import {
  DEFAULT_ROOM,
  DISPLAY_NAME_MAX_CHARS,
  HARNESS_MAX_CHARS,
  PEERS_LIST_DEFAULT_LIMIT,
  PEERS_LIST_MAX_LIMIT,
  ROLE_MAX_CHARS,
  SESSION_ROOMS_CAP,
} from "./limits.js";
import { clampListLimit, pageSortedKeys } from "./page.js";
import { refreshPresence } from "./presence.js";
import {
  requireJoinedSession,
  resolveInspectSessionId,
  resolveSessionId,
} from "./resolve.js";
import { ensureMainRoom } from "./rooms.js";
import type { AgentRecord, BusDeps, PeerInfo, SessionMeta } from "./types.js";

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Session-bound join token. The token itself never crosses the MCP boundary:
 * it lives in LATTICE_JOIN_TOKEN (env). The first token-authorized contact
 * with a session persists sha256(token) once; later joins must hash to the
 * same value, and processes without a token configured cannot join a session
 * that has one. Sessions created without any token stay open.
 */
async function assertJoinToken(deps: BusDeps, sessionId: string): Promise<void> {
  const expected = deps.config.joinToken;
  if (expected) {
    const hash = sha256Hex(expected);
    await deps.store.initJoinTokenHash(sessionId, hash);
    const stored = await deps.store.getJoinTokenHash(sessionId);
    if (!stored || !safeEqual(stored, hash)) {
      throw new UserError(
        "LATTICE_JOIN_TOKEN does not match the token protecting this session.",
        "auth",
      );
    }
    return;
  }
  const stored = await deps.store.getJoinTokenHash(sessionId);
  if (stored) {
    throw new UserError(
      "This session is protected by LATTICE_JOIN_TOKEN. Set the matching token in this process's env to join.",
      "auth",
    );
  }
}

export async function joinSession(
  deps: BusDeps,
  input: {
    session_id?: string;
    role: string;
    agent_id?: string;
    harness?: string;
    display_name?: string;
  },
): Promise<{
  session_id: string;
  agent_id: string;
  namespace: string;
  room_id: string;
  peers: PeerInfo[];
  created: boolean;
}> {
  const role = assertBoundedText(input.role, "role", ROLE_MAX_CHARS);

  const sessionId = resolveSessionId(deps, input.session_id);
  await assertJoinToken(deps, sessionId);

  const agentId =
    optionalId(input.agent_id, "agent_id") ??
    (deps.ctx.sessionId === sessionId ? deps.ctx.agentId : undefined) ??
    randomUUID();

  // An explicit agent_id cannot take over an identity whose presence is still
  // alive — that would let a second process impersonate an online agent.
  // Re-joining as this process's own identity stays allowed.
  if (input.agent_id && deps.ctx.agentId !== agentId) {
    const online = await deps.store.presenceStatus(sessionId, [agentId]);
    if (online[agentId]) {
      throw new UserError(
        `agent_id ${agentId} is already online in this session. Choose a different agent_id, or wait for its presence TTL (${deps.config.presenceTtlSeconds}s) to lapse.`,
        "auth",
      );
    }
  }

  let created = false;
  const existingMeta = await deps.store.getSessionMeta(sessionId);
  if (!existingMeta) {
    const meta: SessionMeta = {
      session_id: sessionId,
      namespace: deps.config.namespace,
      created_at: nowIso(),
      created_by: agentId,
    };
    created = await deps.store.initSessionMeta(sessionId, meta);
  }

  const existingAgent = await deps.store.getAgent(sessionId, agentId);
  const agent: AgentRecord = {
    agent_id: agentId,
    role,
    harness:
      (input.harness?.trim() &&
        assertBoundedText(input.harness, "harness", HARNESS_MAX_CHARS)) ||
      existingAgent?.harness ||
      "unknown",
    display_name:
      (input.display_name?.trim() &&
        assertBoundedText(input.display_name, "display_name", DISPLAY_NAME_MAX_CHARS)) ||
      existingAgent?.display_name ||
      role ||
      agentId,
    joined_at: existingAgent?.joined_at ?? nowIso(),
  };

  await deps.store.putAgent(sessionId, agent);
  await ensureMainRoom(deps, sessionId, agent.agent_id);
  await refreshPresence(deps, sessionId, agent.agent_id);
  deps.ctx.rememberJoin(sessionId, agent);

  const peers = await listPeers(deps, { session_id: sessionId });
  return {
    session_id: sessionId,
    agent_id: agent.agent_id,
    namespace: deps.config.namespace,
    room_id: DEFAULT_ROOM,
    peers: peers.peers,
    created,
  };
}

export async function leaveSession(
  deps: BusDeps,
  input: { session_id?: string } = {},
): Promise<{ left: boolean; session_id: string; agent_id: string }> {
  const { sessionId, agentId } = requireJoinedSession(deps, input.session_id);
  await deps.store.clearPresence(sessionId, agentId);
  await deps.store.removeAgentFromAllRooms(sessionId, agentId);
  await deps.store.removeAgent(sessionId, agentId);
  deps.ctx.clearIf(sessionId, agentId);
  return { left: true, session_id: sessionId, agent_id: agentId };
}

export async function listPeers(
  deps: BusDeps,
  input: { session_id?: string; cursor?: string; limit?: number } = {},
): Promise<{
  session_id: string;
  peers: PeerInfo[];
  peer_count: number;
  online_count: number;
  next_cursor?: string;
  truncated: boolean;
}> {
  const sessionId = resolveInspectSessionId(deps, input.session_id);
  const ids = await deps.store.listAgentIds(sessionId);
  const limit = clampListLimit(input.limit, PEERS_LIST_DEFAULT_LIMIT, PEERS_LIST_MAX_LIMIT);
  const page = pageSortedKeys(ids, input.cursor, limit);
  const agents = await deps.store.getAgents(sessionId, page.items);
  const onlineAll = await deps.store.presenceStatus(sessionId, ids);
  const peers: PeerInfo[] = agents.map((agent) => ({
    ...agent,
    online: Boolean(onlineAll[agent.agent_id]),
  }));
  return {
    session_id: sessionId,
    peers,
    peer_count: ids.length,
    online_count: ids.filter((id) => onlineAll[id]).length,
    next_cursor: page.next_cursor,
    truncated: page.truncated,
  };
}

export async function sessionInfo(
  deps: BusDeps,
  input: { session_id?: string } = {},
): Promise<{
  session_id: string;
  namespace: string;
  store: string;
  peer_count: number;
  rooms: string[];
  rooms_truncated: boolean;
  created_at?: string;
  created_by?: string;
}> {
  const sessionId = resolveInspectSessionId(deps, input.session_id);
  const meta = await deps.store.getSessionMeta(sessionId);
  const peer_count = await deps.store.countAgents(sessionId);
  const allRooms = await deps.store.listRooms(sessionId);
  const rooms = allRooms.slice(0, SESSION_ROOMS_CAP);
  return {
    session_id: sessionId,
    namespace: deps.config.namespace,
    store: deps.store.kind,
    peer_count,
    rooms,
    rooms_truncated: allRooms.length > rooms.length,
    created_at: meta?.created_at,
    created_by: meta?.created_by,
  };
}

export { requireJoinedSession, resolveInspectSessionId, resolveSessionId };
