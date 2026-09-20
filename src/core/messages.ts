import { UserError } from "./errors.js";
import { assertId } from "./ids.js";
import { keys, dmCursorRid, dmPair } from "./keys.js";
import {
  BODY_TRUNCATE_CHARS,
  DEFAULT_ROOM,
  MESSAGE_BODY_MAX_CHARS,
  PULL_DEFAULT_LIMIT,
  PULL_MAX_LIMIT,
} from "./limits.js";
import { requireJoinedSession } from "./resolve.js";
import { assertRoomMember } from "./rooms.js";
import { compareStreamIds } from "./stream.js";
import type { BusDeps, LatticeMessage, MessageKind, StreamEntry } from "./types.js";
import { MESSAGE_KINDS } from "./types.js";
import { currentTraceparent } from "../otel/setup.js";

export { compareStreamIds, exclusiveStart, isAfterCursor } from "./stream.js";

export function clampPullLimit(limit: number | undefined): number {
  const n = limit ?? PULL_DEFAULT_LIMIT;
  if (!Number.isFinite(n)) return PULL_DEFAULT_LIMIT;
  return Math.min(PULL_MAX_LIMIT, Math.max(1, Math.floor(n)));
}

export function truncateBody(
  body: string,
  max = BODY_TRUNCATE_CHARS,
): { body: string; truncated: boolean } {
  if (body.length <= max) return { body, truncated: false };
  return { body: body.slice(0, max), truncated: true };
}

export function parseKind(raw: string | undefined): MessageKind {
  if (raw && (MESSAGE_KINDS as readonly string[]).includes(raw)) {
    return raw as MessageKind;
  }
  return "chat";
}

export function parseStreamMessage(entry: StreamEntry): LatticeMessage {
  const { body, truncated } = truncateBody(entry.fields.body ?? "");
  const to = entry.fields.to?.trim();
  const traceparent = entry.fields.traceparent?.trim();
  const msg: LatticeMessage = {
    id: entry.id,
    from: entry.fields.from ?? "",
    role: entry.fields.role ?? "",
    harness: entry.fields.harness ?? "",
    kind: parseKind(entry.fields.kind),
    body,
    ts: entry.fields.ts ?? "",
  };
  if (to) msg.to = to;
  if (traceparent) msg.traceparent = traceparent;
  if (truncated) msg.truncated = true;
  return msg;
}

function nowIso(): string {
  return new Date().toISOString();
}

async function outboundFields(
  deps: BusDeps,
  input: {
    sessionId: string;
    from: string;
    to?: string;
    body: string;
    kind?: string;
  },
): Promise<Record<string, string>> {
  if (!input.body?.trim()) {
    throw new UserError("body is required.");
  }
  if (input.body.length > MESSAGE_BODY_MAX_CHARS) {
    throw new UserError(`body must be at most ${MESSAGE_BODY_MAX_CHARS} characters.`);
  }
  const stored = await deps.store.getAgent(input.sessionId, input.from);
  const fields: Record<string, string> = {
    from: input.from,
    role: stored?.role || deps.ctx.role || "agent",
    harness: stored?.harness || deps.ctx.harness || "unknown",
    kind: parseKind(input.kind),
    body: input.body,
    ts: nowIso(),
  };
  if (input.to) fields.to = input.to;
  const traceparent = currentTraceparent();
  if (traceparent) fields.traceparent = traceparent;
  return fields;
}

export async function tellRoom(
  deps: BusDeps,
  input: {
    session_id?: string;
    room_id?: string;
    body: string;
    kind?: string;
  },
): Promise<{ message_id: string; room_id: string; session_id: string }> {
  const { sessionId, agentId } = await requireJoinedSession(deps, input.session_id);
  const roomId = assertId(input.room_id?.trim() || DEFAULT_ROOM, "room_id");
  const meta = await deps.store.getRoomMeta(sessionId, roomId);
  if (!meta) {
    throw new UserError(`Room ${roomId} does not exist. Create it with create_room first.`);
  }
  await assertRoomMember(deps, sessionId, roomId, agentId);
  const fields = await outboundFields(deps, {
    sessionId,
    from: agentId,
    body: input.body,
    kind: input.kind,
  });
  const streamKey = keys.roomStream(deps.config.namespace, sessionId, roomId);
  const messageId = await deps.store.addStreamMessage(
    streamKey,
    fields,
    deps.config.streamMaxLen,
  );
  return { message_id: messageId, room_id: roomId, session_id: sessionId };
}

export async function tellAgent(
  deps: BusDeps,
  input: {
    session_id?: string;
    to_agent_id: string;
    body: string;
    kind?: string;
  },
): Promise<{ message_id: string; pair: string; session_id: string }> {
  const { sessionId, agentId: from } = await requireJoinedSession(deps, input.session_id);
  const to = assertId(input.to_agent_id, "to_agent_id");
  if (from === to) {
    throw new UserError("Cannot DM yourself.");
  }
  const fields = await outboundFields(deps, {
    sessionId,
    from,
    to,
    body: input.body,
    kind: input.kind,
  });
  const recipient = await deps.store.getAgent(sessionId, to);
  if (!recipient) {
    throw new UserError(`Agent ${to} is not in this session.`);
  }
  const pair = dmPair(from, to);
  await deps.store.addDmPartner(sessionId, from, to);
  await deps.store.addDmPartner(sessionId, to, from);
  const streamKey = keys.dmStream(deps.config.namespace, sessionId, pair);
  const messageId = await deps.store.addStreamMessage(
    streamKey,
    fields,
    deps.config.streamMaxLen,
  );
  return { message_id: messageId, pair, session_id: sessionId };
}

export interface PullResult {
  session_id: string;
  channel: string;
  messages: LatticeMessage[];
  next_cursor?: string;
  cursors?: Record<string, string>;
  truncated: boolean;
}

async function pullOneStream(
  deps: BusDeps,
  sessionId: string,
  agentId: string,
  rid: string,
  streamKey: string,
  limit: number,
): Promise<{ messages: LatticeMessage[]; next_cursor?: string; truncated: boolean }> {
  const cursor = (await deps.store.getCursor(sessionId, agentId, rid)) ?? "0-0";
  // Read one extra entry so truncated is exact: true only when something
  // actually remains beyond this page.
  const entries = await deps.store.readStreamAfter(streamKey, cursor, limit + 1);
  const truncated = entries.length > limit;
  const page = truncated ? entries.slice(0, limit) : entries;
  const messages = page.map(parseStreamMessage);
  if (messages.length > 0) {
    const next = messages[messages.length - 1]!.id;
    await deps.store.setCursor(sessionId, agentId, rid, next);
    return { messages, next_cursor: next, truncated };
  }
  return { messages, next_cursor: cursor === "0-0" ? undefined : cursor, truncated };
}

export async function pullMessages(
  deps: BusDeps,
  input: {
    session_id?: string;
    room_id?: string;
    inbox?: boolean;
    other_agent_id?: string;
    limit?: number;
  },
): Promise<PullResult> {
  const { sessionId, agentId } = await requireJoinedSession(deps, input.session_id);

  const limit = clampPullLimit(input.limit);
  const inbox =
    input.inbox === true || input.room_id === "inbox" || Boolean(input.other_agent_id);

  if (inbox) {
    return pullInbox(deps, sessionId, agentId, input.other_agent_id, limit);
  }

  const roomId = assertId(input.room_id?.trim() || DEFAULT_ROOM, "room_id");
  const meta = await deps.store.getRoomMeta(sessionId, roomId);
  if (!meta) {
    throw new UserError(`Room ${roomId} does not exist. Create it with create_room first.`);
  }
  await assertRoomMember(deps, sessionId, roomId, agentId);
  const streamKey = keys.roomStream(deps.config.namespace, sessionId, roomId);
  const { messages, next_cursor, truncated } = await pullOneStream(
    deps,
    sessionId,
    agentId,
    roomId,
    streamKey,
    limit,
  );
  return {
    session_id: sessionId,
    channel: `room:${roomId}`,
    messages,
    next_cursor,
    truncated,
  };
}

async function pullInbox(
  deps: BusDeps,
  sessionId: string,
  agentId: string,
  otherAgentId: string | undefined,
  limit: number,
): Promise<PullResult> {
  const partners = otherAgentId
    ? [assertId(otherAgentId, "other_agent_id")]
    : await deps.store.listDmPartners(sessionId, agentId);

  const collected: { rid: string; pair: string; msg: LatticeMessage }[] = [];
  for (const other of partners) {
    const pair = dmPair(agentId, other);
    const rid = dmCursorRid(pair);
    const streamKey = keys.dmStream(deps.config.namespace, sessionId, pair);
    const cursor = (await deps.store.getCursor(sessionId, agentId, rid)) ?? "0-0";
    const entries = await deps.store.readStreamAfter(streamKey, cursor, limit + 1);
    for (const entry of entries) {
      collected.push({ rid, pair, msg: parseStreamMessage(entry) });
    }
  }

  collected.sort((a, b) => compareStreamIds(a.msg.id, b.msg.id));
  const truncated = collected.length > limit;
  const sliced = collected.slice(0, limit);
  const cursors: Record<string, string> = {};
  for (const item of sliced) {
    cursors[item.rid] = item.msg.id;
  }
  await Promise.all(
    Object.entries(cursors).map(([rid, cursor]) =>
      deps.store.setCursor(sessionId, agentId, rid, cursor),
    ),
  );

  const last = sliced[sliced.length - 1];
  return {
    session_id: sessionId,
    channel: otherAgentId ? `dm:${dmPair(agentId, otherAgentId)}` : "inbox",
    messages: sliced.map((x) => x.msg),
    next_cursor: last?.msg.id,
    cursors: Object.keys(cursors).length > 0 ? cursors : undefined,
    truncated,
  };
}
