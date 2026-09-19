import { UserError } from "./errors.js";
import { assertId } from "./ids.js";
import type { BusDeps } from "./types.js";

export function resolveSessionId(deps: BusDeps, explicit?: string): string {
  const raw = explicit?.trim() || deps.ctx.sessionId || deps.config.defaultSessionId;
  if (!raw) {
    throw new UserError(
      "session_id is required. Call join_session first or set LATTICE_DEFAULT_SESSION_ID.",
    );
  }
  return assertId(raw, "session_id");
}

export function resolveAgentId(deps: BusDeps, explicit?: string): string {
  const raw = explicit?.trim() || deps.ctx.agentId;
  if (!raw) {
    throw new UserError("agent_id is required. Call join_session first or pass agent_id.");
  }
  return assertId(raw, "agent_id");
}
