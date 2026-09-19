import { randomUUID } from "node:crypto";
import { safeEqual, sha256Hex } from "./crypto.js";
import { UserError } from "./errors.js";
import { optionalId } from "./ids.js";
import { DEFAULT_ROOM } from "./limits.js";
import { refreshPresence } from "./presence.js";
import { resolveAgentId, resolveSessionId } from "./resolve.js";
import { ensureMainRoom } from "./rooms.js";
import type { AgentRecord, BusDeps, PeerInfo, SessionMeta } from "./types.js";

function nowIso(): string {
  return new Date().toISOString();
}

function assertJoinToken(deps: BusDeps, provided?: string): void {
  const expected = deps.config.joinToken;
  if (!expected) return;
  if (!provided) {
    throw new UserError("join_token is required for this Lattice server.", "auth");
  }
  if (!safeEqual(provided, expected)) {
    throw new UserError("join_token is invalid.", "auth");
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
    join_token?: string;
  },
): Promise<{
  session_id: string;
  agent_id: string;
  namespace: string;
  room_id: string;
  peers: PeerInfo[];
  created: boolean;
}> {
  assertJoinToken(deps, input.join_token);

  const role = input.role?.trim();
  if (!role) {
    throw new UserError("role is required.");
  }

  const sessionId = resolveSessionId(deps, input.session_id);

  const agentId =
    optionalId(input.agent_id, "agent_id") ??
    (deps.ctx.sessionId === sessionId ? deps.ctx.agentId : undefined) ??
    randomUUID();

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

  if (deps.config.joinToken) {
    await deps.store.setJoinTokenHash(sessionId, sha256Hex(deps.config.joinToken));
  }

  const existingAgent = await deps.store.getAgent(sessionId, agentId);
  const agent: AgentRecord = {
    agent_id: agentId,
    role,
    harness: input.harness?.trim() || existingAgent?.harness || "unknown",
    display_name:
      input.display_name?.trim() ||
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
  input: { session_id?: string; agent_id?: string },
): Promise<{ left: boolean; session_id: string; agent_id: string }> {
  const sessionId = resolveSessionId(deps, input.session_id);
  const agentId = resolveAgentId(deps, input.agent_id);
  await deps.store.clearPresence(sessionId, agentId);
  await deps.store.removeAgentFromAllRooms(sessionId, agentId);
  await deps.store.removeAgent(sessionId, agentId);
  deps.ctx.clearIf(sessionId, agentId);
  return { left: true, session_id: sessionId, agent_id: agentId };
}

export async function listPeers(
  deps: BusDeps,
  input: { session_id?: string } = {},
): Promise<{ session_id: string; peers: PeerInfo[]; peer_count: number; online_count: number }> {
  const sessionId = resolveSessionId(deps, input.session_id);
  const agents = await deps.store.listAgents(sessionId);
  const online = await deps.store.presenceStatus(
    sessionId,
    agents.map((a) => a.agent_id),
  );
  const peers: PeerInfo[] = agents.map((agent) => ({
    ...agent,
    online: Boolean(online[agent.agent_id]),
  }));
  return {
    session_id: sessionId,
    peers,
    peer_count: peers.length,
    online_count: peers.filter((p) => p.online).length,
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
  created_at?: string;
  created_by?: string;
}> {
  const sessionId = resolveSessionId(deps, input.session_id);
  const meta = await deps.store.getSessionMeta(sessionId);
  const agents = await deps.store.listAgents(sessionId);
  const rooms = await deps.store.listRooms(sessionId);
  return {
    session_id: sessionId,
    namespace: deps.config.namespace,
    store: deps.store.kind,
    peer_count: agents.length,
    rooms,
    created_at: meta?.created_at,
    created_by: meta?.created_by,
  };
}

export { resolveAgentId, resolveSessionId };
