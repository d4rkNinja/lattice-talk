import { describe, expect, it } from "vitest";
import {
  CLAUDE_CODE_DESCRIPTION_LIMIT_CHARS,
  CLAUDE_CODE_INSTRUCTION_LIMIT_CHARS,
  SERVER_INSTRUCTIONS,
} from "../src/mcp/instructions.js";
import {
  ALL_TOOL_OUTPUT_SCHEMAS,
  ALL_TOOL_SCHEMAS,
  schemaHasSecretFields,
  schemaPropertyNameIssues,
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
      "trace_context",
    ]);

    for (const [name, shape] of Object.entries(ALL_TOOL_SCHEMAS)) {
      expect(Array.isArray(shape), name).toBe(false);
      expect(shape && typeof shape === "object", name).toBe(true);
      expect(schemaHasSecretFields(shape), name).toEqual([]);
      expect(schemaPropertyNameIssues(shape), name).toEqual([]);
      expect("anyOf" in shape || "oneOf" in shape || "allOf" in shape, name).toBe(false);
    }

    for (const [name, shape] of Object.entries(ALL_TOOL_SCHEMAS)) {
      if (name === "join_session") {
        expect("agent_id" in shape).toBe(true);
      } else {
        expect("agent_id" in shape, name).toBe(false);
      }
    }

    expect(Object.keys(ALL_TOOL_OUTPUT_SCHEMAS)).toEqual(names);
    for (const [name, shape] of Object.entries(ALL_TOOL_OUTPUT_SCHEMAS)) {
      expect(Array.isArray(shape), name).toBe(false);
      expect(shape && typeof shape === "object", name).toBe(true);
      expect("anyOf" in shape || "oneOf" in shape || "allOf" in shape, name).toBe(false);
    }
  });

  it("keeps server instructions and schema descriptions under Claude Code 2KB caps", () => {
    expect(SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(CLAUDE_CODE_INSTRUCTION_LIMIT_CHARS);
    expect(CLAUDE_CODE_DESCRIPTION_LIMIT_CHARS).toBe(2048);
  });
});
