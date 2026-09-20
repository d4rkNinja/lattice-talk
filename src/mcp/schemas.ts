import { z } from "zod";
import { CLAUDE_CODE_PROPERTY_NAME } from "./instructions.js";

/** Flat Zod shapes — no root anyOf/oneOf/allOf. ASCII names. No secrets. */

/** Public ids: letters, digits, and . _ - (no ':' — composite keys join with ':'). */
const ID_PATTERN = /^[A-Za-z0-9._-]+$/;
/** Optional-id variant that still lets an empty string fall through to core fallbacks. */
const OPTIONAL_ID_PATTERN = /^[A-Za-z0-9._-]*$/;

export const joinSessionSchema = {
  session_id: z
    .string()
    .max(128)
    .regex(OPTIONAL_ID_PATTERN)
    .optional()
    .describe("Session to join. Falls back to last join or LATTICE_DEFAULT_SESSION_ID."),
  role: z
    .string()
    .min(1)
    .max(64)
    .describe("This agent's role, e.g. frontend, backend, reviewer."),
  agent_id: z
    .string()
    .max(128)
    .regex(OPTIONAL_ID_PATTERN)
    .optional()
    .describe("Optional self-id at join only. Generated if omitted; reused from this process after join."),
  harness: z
    .string()
    .max(64)
    .optional()
    .describe("Harness name: claude-code, cursor, codex, custom."),
  display_name: z.string().max(128).optional().describe("Human-readable name shown to peers."),
};

export const leaveSessionSchema = {
  session_id: z
    .string()
    .max(128)
    .regex(OPTIONAL_ID_PATTERN)
    .optional()
    .describe("Must match the joined session if set. This process leaves; you cannot kick another agent."),
};

export const listPeersSchema = {
  session_id: z
    .string()
    .max(128)
    .regex(OPTIONAL_ID_PATTERN)
    .optional()
    .describe("Must match the joined session or LATTICE_DEFAULT_SESSION_ID."),
  cursor: z.string().max(256).optional().describe("Paginate after this agent_id (sorted)."),
  limit: z
    .coerce.number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe("Max peers to return. Default 100, max 200."),
};

export const sessionInfoSchema = {
  session_id: z
    .string()
    .max(128)
    .regex(OPTIONAL_ID_PATTERN)
    .optional()
    .describe("Must match the joined session or LATTICE_DEFAULT_SESSION_ID."),
};

export const tellAgentSchema = {
  session_id: z
    .string()
    .max(128)
    .regex(OPTIONAL_ID_PATTERN)
    .optional()
    .describe("Must match the joined session if set. Sender is this process."),
  to_agent_id: z
    .string()
    .max(128)
    .regex(ID_PATTERN)
    .describe("Recipient agent id in this session."),
  body: z
    .string()
    .min(1)
    .max(16384)
    .describe("Message body. Over ~2k characters is truncated on read."),
  kind: z
    .enum(["chat", "status", "task", "system"])
    .optional()
    .describe("Message kind. Default chat."),
};

export const tellRoomSchema = {
  session_id: z
    .string()
    .max(128)
    .regex(OPTIONAL_ID_PATTERN)
    .optional()
    .describe("Must match the joined session if set. Sender is this process."),
  room_id: z
    .string()
    .max(128)
    .regex(OPTIONAL_ID_PATTERN)
    .optional()
    .describe("Room to broadcast. Default main. Caller must be a member."),
  body: z
    .string()
    .min(1)
    .max(16384)
    .describe("Message body. Over ~2k characters is truncated on read."),
  kind: z
    .enum(["chat", "status", "task", "system"])
    .optional()
    .describe("Message kind. Default chat."),
};

export const pullMessagesSchema = {
  session_id: z
    .string()
    .max(128)
    .regex(OPTIONAL_ID_PATTERN)
    .optional()
    .describe("Must match the joined session if set. Reader is this process."),
  room_id: z
    .string()
    .max(128)
    .regex(OPTIONAL_ID_PATTERN)
    .optional()
    .describe("Room to read (default main). Caller must be a member. Use inbox to pull DMs instead."),
  inbox: z
    .boolean()
    .optional()
    .describe("If true, pull this process's DM inbox (all pair streams, or one if other_agent_id is set)."),
  other_agent_id: z
    .string()
    .max(128)
    .regex(ID_PATTERN)
    .optional()
    .describe("When pulling inbox, only this DM pair. Does not change who is reading."),
  limit: z
    .coerce.number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe("Max messages to return. Default 50, max 200."),
};

export const createRoomSchema = {
  session_id: z
    .string()
    .max(128)
    .regex(OPTIONAL_ID_PATTERN)
    .optional()
    .describe("Must match the joined session if set. Creator is this process (added as a member)."),
  room_id: z
    .string()
    .max(128)
    .regex(ID_PATTERN)
    .describe("New room id."),
  display_name: z.string().max(128).optional().describe("Optional display name."),
};

export const joinRoomSchema = {
  session_id: z
    .string()
    .max(128)
    .regex(OPTIONAL_ID_PATTERN)
    .optional()
    .describe("Must match the joined session if set. Joiner is this process."),
  room_id: z
    .string()
    .max(128)
    .regex(ID_PATTERN)
    .describe("Room to join."),
};

export const memorySetSchema = {
  session_id: z
    .string()
    .max(128)
    .regex(OPTIONAL_ID_PATTERN)
    .optional()
    .describe("Must match the joined session if set. Writer is this process."),
  key: z
    .string()
    .min(1)
    .max(256)
    .regex(ID_PATTERN)
    .describe("Memory key (letters, digits, . _ -)."),
  value: z
    .string()
    .max(32768)
    .describe("Memory value (shared fact, not a tool dump). Max 32k characters."),
};

export const memoryGetSchema = {
  session_id: z
    .string()
    .max(128)
    .regex(OPTIONAL_ID_PATTERN)
    .optional()
    .describe("Must match the joined session or LATTICE_DEFAULT_SESSION_ID."),
  key: z
    .string()
    .min(1)
    .max(256)
    .regex(ID_PATTERN)
    .describe("Memory key to read."),
};

export const memoryListSchema = {
  session_id: z
    .string()
    .max(128)
    .regex(OPTIONAL_ID_PATTERN)
    .optional()
    .describe("Must match the joined session or LATTICE_DEFAULT_SESSION_ID."),
  include_values: z
    .boolean()
    .optional()
    .describe("If true, include short value previews."),
  cursor: z.string().max(256).optional().describe("Paginate after this key (sorted)."),
  limit: z
    .coerce.number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe("Max keys to return. Default 50, max 200."),
};

export const memoryNoteSchema = {
  session_id: z
    .string()
    .max(128)
    .regex(OPTIONAL_ID_PATTERN)
    .optional()
    .describe("Must match the joined session if set. Author is this process."),
  body: z
    .string()
    .min(1)
    .max(8192)
    .describe("Append-only note body. Max 8k characters."),
};

export const memoryNotesSchema = {
  session_id: z
    .string()
    .max(128)
    .regex(OPTIONAL_ID_PATTERN)
    .optional()
    .describe("Must match the joined session or LATTICE_DEFAULT_SESSION_ID."),
  cursor: z.string().max(128).optional().describe("Read notes after this note id."),
  limit: z
    .coerce.number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe("Max notes to return. Default 50, max 200."),
};

export const traceContextSchema = {
  session_id: z
    .string()
    .max(128)
    .regex(OPTIONAL_ID_PATTERN)
    .optional()
    .describe("Must match the joined session or LATTICE_DEFAULT_SESSION_ID."),
};

const peerOutput = z.object({
  agent_id: z.string(),
  role: z.string(),
  harness: z.string(),
  display_name: z.string(),
  joined_at: z.string(),
  online: z.boolean(),
});

const messageOutput = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string().optional(),
  role: z.string(),
  harness: z.string(),
  kind: z.enum(["chat", "status", "task", "system"]),
  body: z.string(),
  ts: z.string(),
  traceparent: z.string().optional(),
  truncated: z.boolean().optional(),
});

export const joinSessionOutputSchema = {
  session_id: z.string(),
  agent_id: z.string(),
  namespace: z.string(),
  room_id: z.string(),
  peers: z.array(peerOutput),
  created: z.boolean(),
};

export const leaveSessionOutputSchema = {
  left: z.boolean(),
  session_id: z.string(),
  agent_id: z.string(),
};

export const listPeersOutputSchema = {
  session_id: z.string(),
  peers: z.array(peerOutput),
  peer_count: z.number(),
  online_count: z.number(),
  next_cursor: z.string().optional(),
  truncated: z.boolean(),
};

export const sessionInfoOutputSchema = {
  session_id: z.string(),
  namespace: z.string(),
  store: z.string(),
  peer_count: z.number(),
  rooms: z.array(z.string()),
  rooms_truncated: z.boolean(),
  created_at: z.string().optional(),
  created_by: z.string().optional(),
};

export const tellAgentOutputSchema = {
  message_id: z.string(),
  pair: z.string(),
  session_id: z.string(),
};

export const tellRoomOutputSchema = {
  message_id: z.string(),
  room_id: z.string(),
  session_id: z.string(),
};

export const pullMessagesOutputSchema = {
  session_id: z.string(),
  channel: z.string(),
  messages: z.array(messageOutput),
  next_cursor: z.string().optional(),
  cursors: z.record(z.string()).optional(),
  truncated: z.boolean(),
};

export const createRoomOutputSchema = {
  room_id: z.string(),
  created: z.boolean(),
  session_id: z.string(),
};

export const joinRoomOutputSchema = {
  room_id: z.string(),
  members: z.number(),
  session_id: z.string(),
};

export const memorySetOutputSchema = {
  key: z.string(),
  session_id: z.string(),
};

export const memoryGetOutputSchema = {
  key: z.string(),
  value: z.string().nullable(),
  found: z.boolean(),
  updated_at: z.string().optional(),
  updated_by: z.string().optional(),
  session_id: z.string(),
};

export const memoryListOutputSchema = {
  session_id: z.string(),
  keys: z.array(z.string()),
  values: z.record(z.string()).optional(),
  next_cursor: z.string().optional(),
  truncated: z.boolean(),
};

export const memoryNoteOutputSchema = {
  note_id: z.string(),
  session_id: z.string(),
};

export const memoryNotesOutputSchema = {
  session_id: z.string(),
  notes: z.array(
    z.object({
      id: z.string(),
      from: z.string(),
      body: z.string(),
      ts: z.string(),
    }),
  ),
  next_cursor: z.string().optional(),
  truncated: z.boolean(),
};

export const traceContextOutputSchema = {
  session_id: z.string(),
  conversation_id: z.string(),
  traceparent: z.string().nullable(),
  namespace: z.string(),
};

export const ALL_TOOL_OUTPUT_SCHEMAS = {
  join_session: joinSessionOutputSchema,
  leave_session: leaveSessionOutputSchema,
  list_peers: listPeersOutputSchema,
  session_info: sessionInfoOutputSchema,
  tell_agent: tellAgentOutputSchema,
  tell_room: tellRoomOutputSchema,
  pull_messages: pullMessagesOutputSchema,
  create_room: createRoomOutputSchema,
  join_room: joinRoomOutputSchema,
  memory_set: memorySetOutputSchema,
  memory_get: memoryGetOutputSchema,
  memory_list: memoryListOutputSchema,
  memory_note: memoryNoteOutputSchema,
  memory_notes: memoryNotesOutputSchema,
  trace_context: traceContextOutputSchema,
} as const;

export const ALL_TOOL_SCHEMAS = {
  join_session: joinSessionSchema,
  leave_session: leaveSessionSchema,
  list_peers: listPeersSchema,
  session_info: sessionInfoSchema,
  tell_agent: tellAgentSchema,
  tell_room: tellRoomSchema,
  pull_messages: pullMessagesSchema,
  create_room: createRoomSchema,
  join_room: joinRoomSchema,
  memory_set: memorySetSchema,
  memory_get: memoryGetSchema,
  memory_list: memoryListSchema,
  memory_note: memoryNoteSchema,
  memory_notes: memoryNotesSchema,
  trace_context: traceContextSchema,
} as const;

const SECRET_FIELD = /password|redis_url|redis_host|redis_user|secret|credential/i;

export function schemaHasSecretFields(shape: Record<string, unknown>): string[] {
  return Object.keys(shape).filter((k) => SECRET_FIELD.test(k));
}

/** Claude Code rejects top-level properties outside 1–64 ASCII [A-Za-z0-9_.-]. */
export function schemaPropertyNameIssues(shape: Record<string, unknown>): string[] {
  return Object.keys(shape).filter((k) => !CLAUDE_CODE_PROPERTY_NAME.test(k));
}
