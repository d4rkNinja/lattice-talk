import { describe, expect, it } from "vitest";
import {
  CLAUDE_CODE_DESCRIPTION_LIMIT_CHARS,
  CLAUDE_CODE_INSTRUCTION_LIMIT_CHARS,
  SERVER_INSTRUCTIONS,
} from "../src/mcp/instructions.js";
import {
  ALL_TOOL_OUTPUT_SCHEMAS,
  ALL_TOOL_SCHEMAS,
  joinSessionSchema,
  memoryNoteSchema,
  schemaHasSecretFields,
  schemaPropertyNameIssues,
  tellAgentSchema,
} from "../src/mcp/schemas.js";

describe("tool schemas", () => {
  it("are flat objects with ASCII names and no Redis credential fields", () => {
    const names = Object.keys(ALL_TOOL_SCHEMAS);
    expect(names).toEqual([
      "join_session",
      "leave_session",
      "list_peers",
      "session_info",
      "tell_agent",
      "tell_room",
      "pull_messages",
      "create_room",
      "join_room",
      "memory_set",
      "memory_get",
      "memory_list",
      "memory_note",
      "memory_notes",
      "trace_context",
    ]);

    for (const [name, schema] of Object.entries(ALL_TOOL_SCHEMAS)) {
      const shape = schema.shape as Record<string, unknown>;
      expect(Array.isArray(shape), name).toBe(false);
      expect(shape && typeof shape === "object", name).toBe(true);
      expect(schemaHasSecretFields(schema), name).toEqual([]);
      expect(schemaPropertyNameIssues(schema), name).toEqual([]);
    }

    for (const [name, schema] of Object.entries(ALL_TOOL_SCHEMAS)) {
      if (name === "join_session") {
        expect("agent_id" in schema.shape).toBe(true);
      } else {
        expect("agent_id" in schema.shape, name).toBe(false);
      }
      // No tool takes a secret: join tokens live in env only.
      expect("join_token" in schema.shape, name).toBe(false);
      expect("token" in schema.shape, name).toBe(false);
    }

    expect(Object.keys(ALL_TOOL_OUTPUT_SCHEMAS)).toEqual(names);
    for (const [name, schema] of Object.entries(ALL_TOOL_OUTPUT_SCHEMAS)) {
      expect(schema && typeof schema === "object", name).toBe(true);
    }
  });

  it("bounds free-text and id fields at the schema layer", () => {
    const join = joinSessionSchema;
    expect(join.safeParse({ role: "x".repeat(65) }).success).toBe(false);
    expect(join.safeParse({ role: "frontend" }).success).toBe(true);
    expect(join.safeParse({ role: "fe", agent_id: "bad:id" }).success).toBe(false);
    expect(join.safeParse({ role: "fe", agent_id: "ok.id_1-x" }).success).toBe(true);

    const tell = tellAgentSchema;
    expect(tell.safeParse({ to_agent_id: "bad:id", body: "hi" }).success).toBe(false);
    expect(tell.safeParse({ to_agent_id: "be", body: "x".repeat(16385) }).success).toBe(false);
    expect(tell.safeParse({ to_agent_id: "be", body: "hi" }).success).toBe(true);

    const note = memoryNoteSchema;
    expect(note.safeParse({ body: "x".repeat(8193) }).success).toBe(false);
    expect(note.safeParse({ body: "note" }).success).toBe(true);
  });

  it("keeps server instructions and schema descriptions under Claude Code 2KB caps", () => {
    expect(SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(CLAUDE_CODE_INSTRUCTION_LIMIT_CHARS);
    expect(CLAUDE_CODE_DESCRIPTION_LIMIT_CHARS).toBe(2048);
  });
});
