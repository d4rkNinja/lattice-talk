import type { CallToolResult } from "@modelcontextprotocol/server";
import type { BusDeps } from "../core/types.js";
import { withSpan, type SpanAttrs } from "../otel/setup.js";
import { toolCaught } from "./result.js";

export function spanAttrs(deps: BusDeps, extra: Partial<SpanAttrs> = {}): SpanAttrs {
  return {
    sessionId: extra.sessionId || deps.ctx.sessionId || deps.config.defaultSessionId,
    agentId: extra.agentId || deps.ctx.agentId,
    role: extra.role || deps.ctx.role,
    displayName: extra.displayName || deps.ctx.displayName,
    harness: extra.harness || deps.ctx.harness,
    roomId: extra.roomId,
    namespace: deps.config.namespace,
  };
}

export async function runTool(
  name: string,
  deps: BusDeps,
  attrs: Partial<SpanAttrs>,
  fn: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    return await withSpan(name, spanAttrs(deps, attrs), fn);
  } catch (err) {
    return toolCaught(err);
  }
}
