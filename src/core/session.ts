import { randomUUID } from "node:crypto";
import { safeEqual, sha256Hex } from "./crypto.js";
import { UserError } from "./errors.js";
import { assertBoundedText, assertId, optionalId } from "./ids.js";
import {
  DEFAULT_ROOM,
  DISPLAY_NAME_MAX_CHARS,
  HARNESS_MAX_CHARS,
  PEERS_LIST_DEFAULT_LIMIT,
  PEERS_LIST_MAX_LIMIT,
  ROLE_MAX_CHARS,
  SESSION_ROOMS_CAP,
} from "./limits.js";
import { keys } from "./keys.js";
import { publishNotify } from "./notify.js";
import { clampListLimit, pageSortedKeys } from "./page.js";
import { refreshPresence } from "./presence.js";
import {
  requireJoinedSession,
  resolveInspectSessionIdAuthorized,
  resolveSessionId,
} from "./resolve.js";
import { ensureMainRoom, ensureRoom } from "./rooms.js";
import type { AgentRecord, BusDeps, JoinPolicy, PeerInfo, SessionMeta } from "./types.js";

function nowIso(): string {
  return new Date().toISOString();
}

function tokenHash(deps: BusDeps): string | undefined {
  return deps.config.joinToken ? sha256Hex(deps.config.joinToken) : undefined;
}

/** sha256(config.joinToken) vs the hash stored in the session meta. */
function hashMatches(meta: SessionMeta, hash: string | undefined): boolean {
  return Boolean(hash && meta.join_token_hash && safeEqual(meta.join_token_hash, hash));
}

/**
 * Join-token policy, fixed at session creation and stored inside the session
 * meta (created atomically with it):
 *
 *   session doesn't exist → create it now; policy = token (with hash) when
 *                           this process has LATTICE_JOIN_TOKEN, else open.
 *   policy = open         → tokens have no effect; an open session can never
 *                           be retroactively locked.
 *   policy = token        → this process's env token must hash to the stored
 *                           value; processes without it cannot join.
 *
 * The token itself never crosses the MCP boundary: it lives in env only.
 */
function assertJoinPolicy(meta: SessionMeta | null, deps: BusDeps): void {
  if (!meta) return; // caller creates the session with its policy atomically
  if (meta.join_policy === "open") return;
  const hash = tokenHash(deps);
  if (!hashMatches(meta, hash)) {
    throw new UserError(
      "This session is token-protected. Set the matching LATTICE_JOIN_TOKEN in this process's env to join.",
      "auth",
    );
  }
}

/**
 * Create the session atomically if absent (join policy fixed by this
 * process's LATTICE_JOIN_TOKEN), verify read access if it already exists,
 * and ensure the default `main` room. Used by the TUI/CLI, which observes
 * sessions without joining as an agent.
 */
export async function ensureWorkspaceSession(
  deps: BusDeps,
  sessionId: string,
): Promise<{ session_id: string; created: boolean; join_policy: JoinPolicy }> {
  const sid = assertId(sessionId, "session_id");
  let meta = await deps.store.getSessionMeta(sid);
  assertJoinPolicy(meta, deps);
  let created = false;
  if (!meta) {
    const hash = tokenHash(deps);
    const fresh: SessionMeta = {
      session_id: sid,
      namespace: deps.config.namespace,
      created_at: nowIso(),
      created_by: "lattice",
      join_policy: hash ? "token" : "open",
      ...(hash ? { join_token_hash: hash } : {}),
    };
    created = await deps.store.initSessionMeta(sid, fresh);
    meta = (await deps.store.getSessionMeta(sid)) ?? fresh;
    if (!created) {
      assertJoinPolicy(meta, deps);
    }
  }
  await ensureRoom(deps, sid, DEFAULT_ROOM, "lattice", DEFAULT_ROOM);
  return {
    session_id: sid,
    created,
    join_policy: meta.join_policy,
  };
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

  const agentId =
    optionalId(input.agent_id, "agent_id") ??
    (deps.ctx.sessionId === sessionId ? deps.ctx.agentId : undefined) ??
    randomUUID();

  // An explicit agent_id cannot take over an identity whose presence is still
  // alive — that would let a second process impersonate an online agent.
  // Re-joining as this process's own identity stays allowed. Presence is
  // refreshed on every joined operation, so an actively working agent keeps
  // its claim rather than losing it after a TTL of silence.
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
  assertJoinPolicy(existingMeta, deps);
  if (!existingMeta) {
    const hash = tokenHash(deps);
    const meta: SessionMeta = {
      session_id: sessionId,
      namespace: deps.config.namespace,
      created_at: nowIso(),
      created_by: agentId,
      join_policy: hash ? "token" : "open",
      ...(hash ? { join_token_hash: hash } : {}),
    };
    // Loser of the create race re-reads: another creator may have made the
    // session open or token-protected in the meantime — its policy wins.
    created = await deps.store.initSessionMeta(sessionId, meta);
    if (!created) {
      assertJoinPolicy(await deps.store.getSessionMeta(sessionId), deps);
    }
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
  await publishNotify(deps.store, keys.notifyMeta(deps.config.namespace, sessionId), {
    type: "agents",
    agent_id: agent.agent_id,
  });

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
  const { sessionId, agentId } = await requireJoinedSession(deps, input.session_id);
  await deps.store.clearPresence(sessionId, agentId);
  await deps.store.removeAgentFromAllRooms(sessionId, agentId);
  // A freed agent_id must not carry the previous occupant's read cursors or
  // DM partner list into its next life.
  await deps.store.clearAgentState(sessionId, agentId);
  await deps.store.removeAgent(sessionId, agentId);
  deps.ctx.clearIf(sessionId, agentId);
  await publishNotify(deps.store, keys.notifyMeta(deps.config.namespace, sessionId), {
    type: "agents",
    agent_id: agentId,
  });
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
  const sessionId = await resolveInspectSessionIdAuthorized(deps, input.session_id);
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
  const sessionId = await resolveInspectSessionIdAuthorized(deps, input.session_id);
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

export { requireJoinedSession, resolveInspectSessionIdAuthorized, resolveSessionId };
