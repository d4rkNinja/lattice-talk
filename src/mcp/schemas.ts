import { z } from "zod";
import { CLAUDE_CODE_PROPERTY_NAME } from "./instructions.js";

/** Flat Zod shapes — no root anyOf/oneOf/allOf. ASCII names. No Redis credential fields. */

export const joinSessionSchema = {
  session_id: z
    .string()
    .optional()
    .describe("Session to join. Falls back to last join or LATTICE_DEFAULT_SESSION_ID."),
  role: z.string().describe("This agent's role, e.g. frontend, backend, reviewer."),
  agent_id: z
    .string()
    .optional()
    .describe("Stable agent id. Generated if omitted; reused from this process after join."),
  harness: z
    .string()
    .optional()
    .describe("Harness name: claude-code, cursor, codex, custom."),
  display_name: z.string().optional().describe("Human-readable name shown to peers."),
  join_token: z
    .string()
    .optional()
    .describe("Required only when the server set LATTICE_JOIN_TOKEN. Never a Redis password."),
};

export const leaveSessionSchema = {
  session_id: z.string().optional().describe("Session to leave. Defaults to last joined."),
  agent_id: z.string().optional().describe("Agent leaving. Defaults to last joined."),
};

export const listPeersSchema = {
  session_id: z.string().optional().describe("Session to inspect. Defaults to last joined."),
};

export const sessionInfoSchema = {
  session_id: z.string().optional().describe("Session to inspect. Defaults to last joined."),
};

export const tellAgentSchema = {
  session_id: z.string().optional().describe("Session id. Defaults to last joined."),
  agent_id: z.string().optional().describe("Sender agent id. Defaults to last joined."),
  to_agent_id: z.string().describe("Recipient agent id in this session."),
  body: z.string().describe("Message body."),
  kind: z
    .enum(["chat", "status", "task", "system"])
    .optional()
    .describe("Message kind. Default chat."),
  role: z.string().optional().describe("Override sender role on this message."),
  harness: z.string().optional().describe("Override sender harness on this message."),
};

export const tellRoomSchema = {
  session_id: z.string().optional().describe("Session id. Defaults to last joined."),
  agent_id: z.string().optional().describe("Sender agent id. Defaults to last joined."),
  room_id: z.string().optional().describe("Room to broadcast. Default main."),
  body: z.string().describe("Message body."),
  kind: z
    .enum(["chat", "status", "task", "system"])
    .optional()
    .describe("Message kind. Default chat."),
  role: z.string().optional().describe("Override sender role on this message."),
  harness: z.string().optional().describe("Override sender harness on this message."),
};

export const pullMessagesSchema = {
  session_id: z.string().optional().describe("Session id. Defaults to last joined."),
  agent_id: z.string().optional().describe("Reader agent id. Defaults to last joined."),
  room_id: z
    .string()
    .optional()
    .describe("Room to read (default main). Use inbox to pull DMs instead."),
  inbox: z
    .boolean()
    .optional()
    .describe("If true, pull DM inbox (all pair streams, or one if other_agent_id is set)."),
  other_agent_id: z
    .string()
    .optional()
    .describe("When pulling inbox, only this DM pair."),
  limit: z
    .coerce.number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe("Max messages to return. Default 50, max 200."),
};

export const createRoomSchema = {
  session_id: z.string().optional().describe("Session id. Defaults to last joined."),
  agent_id: z.string().optional().describe("Creator agent id. Defaults to last joined."),
  room_id: z.string().describe("New room id."),
  display_name: z.string().optional().describe("Optional display name."),
};

export const joinRoomSchema = {
  session_id: z.string().optional().describe("Session id. Defaults to last joined."),
  agent_id: z.string().optional().describe("Joining agent id. Defaults to last joined."),
  room_id: z.string().describe("Room to join."),
};

export const memorySetSchema = {
  session_id: z.string().optional().describe("Session id. Defaults to last joined."),
  agent_id: z.string().optional().describe("Who is writing. Defaults to last joined."),
  key: z.string().describe("Memory key."),
  value: z.string().describe("Memory value (shared fact, not a tool dump)."),
};

export const memoryGetSchema = {
  session_id: z.string().optional().describe("Session id. Defaults to last joined."),
  key: z.string().describe("Memory key to read."),
};

export const memoryListSchema = {
  session_id: z.string().optional().describe("Session id. Defaults to last joined."),
  include_values: z
    .boolean()
    .optional()
    .describe("If true, include short value previews."),
};

export const memoryNoteSchema = {
  session_id: z.string().optional().describe("Session id. Defaults to last joined."),
  agent_id: z.string().optional().describe("Author agent id. Defaults to last joined."),
  body: z.string().describe("Append-only note body."),
};

export const traceContextSchema = {
  session_id: z.string().optional().describe("Session / conversation id override."),
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
};

export const sessionInfoOutputSchema = {
  session_id: z.string(),
  namespace: z.string(),
  store: z.string(),
  peer_count: z.number(),
  rooms: z.array(z.string()),
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
  session_id: z.string(),
};

export const memoryListOutputSchema = {
  session_id: z.string(),
  keys: z.array(z.string()),
  values: z.record(z.string()).optional(),
  truncated: z.boolean(),
};

export const memoryNoteOutputSchema = {
  note_id: z.string(),
  session_id: z.string(),
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
