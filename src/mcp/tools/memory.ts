import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { memoryGet, memoryList, memoryNote, memorySet } from "../../core/memory.js";
import { resolveInspectSessionId } from "../../core/resolve.js";
import type { BusDeps } from "../../core/types.js";
import { readOnly, write } from "../annotations.js";
import { toolOk } from "../result.js";
import { runTool } from "../run.js";
import {
  memoryGetOutputSchema,
  memoryGetSchema,
  memoryListOutputSchema,
  memoryListSchema,
  memoryNoteOutputSchema,
  memoryNoteSchema,
  memorySetOutputSchema,
  memorySetSchema,
} from "../schemas.js";

export function registerMemoryTools(server: McpServer, deps: BusDeps): void {
  server.registerTool(
    "memory_set",
    {
      description:
        "Set a shared session fact (key/value) as this joined process. Use for decisions and pointers — not raw tool-call dumps. Visible to every agent in the session.",
      inputSchema: memorySetSchema,
      outputSchema: memorySetOutputSchema,
      annotations: write("Set memory", { idempotentHint: true }),
    },
    async (args) =>
      runTool(
        "memory_set",
        deps,
        { sessionId: args.session_id },
        async () => toolOk(await memorySet(deps, args)),
      ),
  );

  server.registerTool(
    "memory_get",
    {
      description: "Read a shared session memory key.",
      inputSchema: memoryGetSchema,
      outputSchema: memoryGetOutputSchema,
      annotations: readOnly("Get memory"),
    },
    async (args) =>
      runTool("memory_get", deps, { sessionId: args.session_id }, async () => {
        const sessionId = resolveInspectSessionId(deps, args.session_id);
        return toolOk(await memoryGet(deps, { ...args, session_id: sessionId }));
      }),
  );

  server.registerTool(
    "memory_list",
    {
      description:
        "List shared memory keys (paginated; default 50, max 200). Set include_values for short previews.",
      inputSchema: memoryListSchema,
      outputSchema: memoryListOutputSchema,
      annotations: readOnly("List memory"),
    },
    async (args) =>
      runTool("memory_list", deps, { sessionId: args.session_id }, async () => {
        const sessionId = resolveInspectSessionId(deps, args.session_id);
        return toolOk(await memoryList(deps, { ...args, session_id: sessionId }));
      }),
  );

  server.registerTool(
    "memory_note",
    {
      description: "Append an immutable note to the session notes stream as this joined process.",
      inputSchema: memoryNoteSchema,
      outputSchema: memoryNoteOutputSchema,
      annotations: write("Append memory note"),
    },
    async (args) =>
      runTool(
        "memory_note",
        deps,
        { sessionId: args.session_id },
        async () => toolOk(await memoryNote(deps, args)),
      ),
  );
}
