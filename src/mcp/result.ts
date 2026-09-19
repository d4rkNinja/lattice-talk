import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { isUserError } from "../core/errors.js";
import { log } from "../log.js";

export function toolOk(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
  };
}

export function toolErr(message: string, extra?: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message, ...extra }) }],
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
