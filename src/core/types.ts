import type { LatticeConfig } from "./config.js";
import type { RuntimeContext } from "./context.js";
import type { Store } from "./store.js";

export type MessageKind = "chat" | "status" | "task" | "system";

export const MESSAGE_KINDS: readonly MessageKind[] = ["chat", "status", "task", "system"];

export interface SessionMeta {
  session_id: string;
  namespace: string;
  created_at: string;
  created_by: string;
}

export interface AgentRecord {
  agent_id: string;
  role: string;
  harness: string;
  display_name: string;
  joined_at: string;
}

export interface RoomMeta {
  room_id: string;
  session_id: string;
  display_name: string;
  created_at: string;
  created_by: string;
}

export interface LatticeMessage {
  id: string;
  from: string;
  to?: string;
  role: string;
  harness: string;
  kind: MessageKind;
  body: string;
  ts: string;
  traceparent?: string;
  truncated?: boolean;
}

export interface StreamEntry {
  id: string;
  fields: Record<string, string>;
}

export interface PeerInfo extends AgentRecord {
  online: boolean;
}

export interface BusDeps {
  store: Store;
  config: LatticeConfig;
  ctx: RuntimeContext;
}
