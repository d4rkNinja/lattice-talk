import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { isUserError } from "../core/errors.js";
import { log } from "../log.js";

/**
 * MCP 2026-07-28 tool results: text content for clients that only read
 * `content`, plus `structuredContent` (same JSON). Errors use isError so
 * the model can retry; they are not JSON-RPC protocol failures.
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
    structuredContent: payload,
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
