import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveSessionId } from "../../core/resolve.js";
import type { BusDeps } from "../../core/types.js";
import { currentTraceparent } from "../../otel/setup.js";
import { readOnly } from "../annotations.js";
import { toolOk } from "../result.js";
import { runTool } from "../run.js";
import { traceContextOutputSchema, traceContextSchema } from "../schemas.js";

export function registerObservabilityTools(server: McpServer, deps: BusDeps): void {
  server.registerTool(
    "trace_context",
    {
      description:
        "Return session_id, conversation_id (same as session_id / gen_ai.conversation.id), current W3C traceparent, and namespace for log correlation.",
      inputSchema: traceContextSchema,
      outputSchema: traceContextOutputSchema,
      annotations: readOnly("Trace context"),
    },
    async (args) =>
      runTool("trace_context", deps, { sessionId: args.session_id }, async () => {
        const sessionId = resolveSessionId(deps, args.session_id);
        return toolOk({
          session_id: sessionId,
          conversation_id: sessionId,
          traceparent: currentTraceparent() ?? null,
          namespace: deps.config.namespace,
        });
      }),
  );
}
