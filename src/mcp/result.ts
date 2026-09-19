import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { isUserError } from "../core/errors.js";
import { log } from "../log.js";

/**
 * Feature-aligned tool results (2026-07-28 docs): text `content` for clients
 * that only read that field, plus `structuredContent` (same JSON) matching
 * each tool's published `outputSchema`. Errors use isError so the model can
 * retry; they are not JSON-RPC protocol failures. Wire handshake is still
 * SDK v1 / initialize.
 */
function asStructured(data: unknown): Record<string, unknown> | undefined {
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return undefined;
}

export function toolOk(data: unknown): CallToolResult {
  const text = JSON.stringify(data);
  const structuredContent = asStructured(data);
  return {
    content: [{ type: "text", text }],
    ...(structuredContent ? { structuredContent } : {}),
  };
}

export function toolErr(message: string, extra?: Record<string, unknown>): CallToolResult {
  const payload = { error: message, ...extra };
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    // SDK v1 client validates structuredContent against outputSchema even on
    // isError. Omit it so execution errors stay tool results, not -32602.
    isError: true,
  };
}

export function toolCaught(err: unknown): CallToolResult {
  if (isUserError(err)) {
    return toolErr(err.message, { code: err.code });
  }
  const message = err instanceof Error ? err.message : String(err);
  log("tool error", message);
  return toolErr(message);
}
