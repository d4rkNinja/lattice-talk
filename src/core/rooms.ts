import { UserError } from "./errors.js";
import { assertBoundedText, assertId } from "./ids.js";
import { keys } from "./keys.js";
import { DEFAULT_ROOM, DISPLAY_NAME_MAX_CHARS } from "./limits.js";
import { publishNotify } from "./notify.js";
import { requireJoinedSession } from "./resolve.js";
import type { BusDeps, RoomMeta } from "./types.js";

function nowIso(): string {
  return new Date().toISOString();
}

export async function assertRoomMember(
  deps: BusDeps,
  sessionId: string,
  roomId: string,
  agentId: string,
): Promise<void> {
  const member = await deps.store.isRoomMember(sessionId, roomId, agentId);
  if (!member) {
    throw new UserError(`Not a member of room ${roomId}. Call join_room first.`);
  }
}

export async function ensureRoom(
  deps: BusDeps,
  sessionId: string,
  roomId: string,
  createdBy: string,
  displayName?: string,
): Promise<{ created: boolean; meta: RoomMeta }> {
  const rid = assertId(roomId, "room_id");
  const existing = await deps.store.getRoomMeta(sessionId, rid);
  if (existing) {
    return { created: false, meta: existing };
  }
  const meta: RoomMeta = {
    room_id: rid,
    session_id: sessionId,
    display_name: displayName
      ? assertBoundedText(displayName, "display_name", DISPLAY_NAME_MAX_CHARS)
      : rid,
    created_at: nowIso(),
    created_by: createdBy,
  };
  const created = await deps.store.addRoom(sessionId, rid, meta);
  const finalMeta = (await deps.store.getRoomMeta(sessionId, rid)) ?? meta;
  if (created) {
    await publishNotify(deps.store, keys.notifyMeta(deps.config.namespace, sessionId), {
      type: "rooms",
      room_id: rid,
    });
  }
  return { created, meta: finalMeta };
}

export async function ensureMainRoom(
  deps: BusDeps,
  sessionId: string,
  agentId: string,
): Promise<void> {
  await ensureRoom(deps, sessionId, DEFAULT_ROOM, agentId, DEFAULT_ROOM);
  await deps.store.addRoomMember(sessionId, DEFAULT_ROOM, agentId);
}

export async function createRoom(
  deps: BusDeps,
  input: {
    session_id?: string;
    room_id: string;
    display_name?: string;
  },
): Promise<{ room_id: string; created: boolean; session_id: string }> {
  const { sessionId, agentId } = await requireJoinedSession(deps, input.session_id);
  const { created, meta } = await ensureRoom(
    deps,
    sessionId,
    input.room_id,
    agentId,
    input.display_name,
  );
  await deps.store.addRoomMember(sessionId, meta.room_id, agentId);
  return { room_id: meta.room_id, created, session_id: sessionId };
}

export async function joinRoom(
  deps: BusDeps,
  input: { session_id?: string; room_id: string },
): Promise<{ room_id: string; members: number; session_id: string }> {
  const { sessionId, agentId } = await requireJoinedSession(deps, input.session_id);
  const roomId = assertId(input.room_id, "room_id");
  const meta = await deps.store.getRoomMeta(sessionId, roomId);
  if (!meta) {
    throw new UserError(`Room ${roomId} does not exist. Create it with create_room first.`);
  }
  await deps.store.addRoomMember(sessionId, roomId, agentId);
  const members = await deps.store.listRoomMembers(sessionId, roomId);
  await publishNotify(deps.store, keys.notifyMeta(deps.config.namespace, sessionId), {
    type: "rooms",
    room_id: roomId,
  });
  return { room_id: roomId, members: members.length, session_id: sessionId };
}
