import type { McpServer } from "@modelcontextprotocol/server";
import {
  memoryGet,
  memoryList,
  memoryNote,
  memoryNotes,
  memorySet,
} from "../../core/memory.js";
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
  memoryNotesOutputSchema,
  memoryNotesSchema,
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
      runTool(
        "memory_get",
        deps,
        { sessionId: args.session_id },
        async () => toolOk(await memoryGet(deps, args)),
      ),
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
      runTool(
        "memory_list",
        deps,
        { sessionId: args.session_id },
        async () => toolOk(await memoryList(deps, args)),
      ),
  );

  server.registerTool(
    "memory_note",
    {
      description:
        "Append an immutable note (max 8k chars) to the session notes stream as this joined process. Read notes back with memory_notes.",
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

  server.registerTool(
    "memory_notes",
    {
      description:
        "Read notes appended with memory_note (paginated, oldest first; default 50, max 200). Pass cursor from the previous page to continue.",
      inputSchema: memoryNotesSchema,
      outputSchema: memoryNotesOutputSchema,
      annotations: readOnly("Read memory notes"),
    },
    async (args) =>
      runTool(
        "memory_notes",
        deps,
        { sessionId: args.session_id },
        async () => toolOk(await memoryNotes(deps, args)),
      ),
  );
}
