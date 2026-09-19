import { UserError } from "./errors.js";
import { assertMemoryKey } from "./ids.js";
import { MEMORY_LIST_PREVIEW_CHARS, MEMORY_VALUE_MAX_CHARS } from "./limits.js";
import { resolveAgentId, resolveSessionId } from "./resolve.js";
import { truncateBody } from "./messages.js";
import type { BusDeps } from "./types.js";

export async function memorySet(
  deps: BusDeps,
  input: { session_id?: string; agent_id?: string; key: string; value: string },
): Promise<{ key: string; session_id: string }> {
  const sessionId = resolveSessionId(deps, input.session_id);
  const key = assertMemoryKey(input.key);
  if (input.value === undefined || input.value === null) {
    throw new UserError("value is required.");
  }
  if (input.value.length > MEMORY_VALUE_MAX_CHARS) {
    throw new UserError(`value must be at most ${MEMORY_VALUE_MAX_CHARS} characters.`);
  }
  let updatedBy: string | undefined;
  try {
    updatedBy = resolveAgentId(deps, input.agent_id);
  } catch {
    updatedBy = undefined;
  }
  await deps.store.memorySet(sessionId, key, input.value, {
    updated_at: new Date().toISOString(),
    ...(updatedBy ? { updated_by: updatedBy } : {}),
  });
  return { key, session_id: sessionId };
}

export async function memoryGet(
  deps: BusDeps,
  input: { session_id?: string; key: string },
): Promise<{ key: string; value: string | null; found: boolean; session_id: string }> {
  const sessionId = resolveSessionId(deps, input.session_id);
  const key = assertMemoryKey(input.key);
  const value = await deps.store.memoryGet(sessionId, key);
  return { key, value, found: value !== null, session_id: sessionId };
}

export async function memoryList(
  deps: BusDeps,
  input: { session_id?: string; include_values?: boolean },
): Promise<{
  session_id: string;
  keys: string[];
  values?: Record<string, string>;
  truncated: boolean;
}> {
  const sessionId = resolveSessionId(deps, input.session_id);
  const all = await deps.store.memoryList(sessionId);
  const keys = Object.keys(all).sort();
  if (!input.include_values) {
    return { session_id: sessionId, keys, truncated: false };
  }
  const values: Record<string, string> = {};
  let truncated = false;
  for (const key of keys) {
    const raw = all[key] ?? "";
    const cut = truncateBody(raw, MEMORY_LIST_PREVIEW_CHARS);
    values[key] = cut.body;
    if (cut.truncated) truncated = true;
  }
  return { session_id: sessionId, keys, values, truncated };
}

export async function memoryNote(
  deps: BusDeps,
  input: { session_id?: string; agent_id?: string; body: string },
): Promise<{ note_id: string; session_id: string }> {
  const sessionId = resolveSessionId(deps, input.session_id);
  if (!input.body?.trim()) {
    throw new UserError("body is required.");
  }
  let from = "unknown";
  try {
    from = resolveAgentId(deps, input.agent_id);
  } catch {
    from = deps.ctx.agentId ?? "unknown";
  }
  const noteId = await deps.store.appendNote(sessionId, {
    from,
    body: input.body,
    ts: new Date().toISOString(),
    kind: "note",
  });
  return { note_id: noteId, session_id: sessionId };
}
