import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/client";
import type { McpServer } from "@modelcontextprotocol/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryStore } from "../src/core/memory-store.js";
import {
  CLAUDE_CODE_DESCRIPTION_LIMIT_CHARS,
  CLAUDE_CODE_INSTRUCTION_LIMIT_CHARS,
  CLAUDE_CODE_PROPERTY_NAME,
  SERVER_INSTRUCTIONS,
} from "../src/mcp/instructions.js";
import { createMcpServer } from "../src/mcp/server.js";
import { makeDeps } from "./helpers.js";

const EXPECTED_TOOLS = [
  "create_room",
  "join_room",
  "join_session",
  "leave_session",
  "list_peers",
  "memory_get",
  "memory_list",
  "memory_note",
  "memory_notes",
  "memory_set",
  "pull_messages",
  "session_info",
  "tell_agent",
  "tell_room",
  "trace_context",
] as const;

const READ_ONLY = new Set([
  "list_peers",
  "session_info",
  "memory_get",
  "memory_list",
  "memory_notes",
  "trace_context",
]);

const DESTRUCTIVE = new Set(["leave_session"]);

describe("Claude Code MCP contract", () => {
  let client: Client;
  let server: McpServer;
  let store: MemoryStore;

  beforeAll(async () => {
    store = new MemoryStore("contract");
    server = createMcpServer(makeDeps(store));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "lattice-contract", version: "0.0.1" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterAll(async () => {
    await client.close();
    await server.close();
    await store.close();
  });

  it("advertises concise server instructions for tool search", () => {
    expect(SERVER_INSTRUCTIONS.length).toBeGreaterThan(0);
    expect(SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(CLAUDE_CODE_INSTRUCTION_LIMIT_CHARS);
    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
  });

  it("lists 15 tools with flat, ASCII, secret-free input schemas and annotations", async () => {
    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name).sort();
    expect(names).toEqual([...EXPECTED_TOOLS].sort());

    for (const tool of listed.tools) {
      expect(tool.description?.length ?? 0).toBeLessThanOrEqual(
        CLAUDE_CODE_DESCRIPTION_LIMIT_CHARS,
      );
      expect(tool.description).toBeTruthy();

      const schema = tool.inputSchema as Record<string, unknown>;
      expect(schema.type, tool.name).toBe("object");
      expect(schema.anyOf, tool.name).toBeUndefined();
      expect(schema.oneOf, tool.name).toBeUndefined();
      expect(schema.allOf, tool.name).toBeUndefined();

      const props = (schema.properties ?? {}) as Record<string, unknown>;
      for (const key of Object.keys(props)) {
        expect(key, `${tool.name}.${key}`).toMatch(CLAUDE_CODE_PROPERTY_NAME);
        expect(key, `${tool.name}.${key}`).not.toMatch(
          /password|redis_url|redis_host|redis_user|credential/i,
        );
      }

      expect(tool.annotations, tool.name).toBeTruthy();
      expect(tool.annotations?.openWorldHint, tool.name).toBe(false);
      if (READ_ONLY.has(tool.name)) {
        expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
      } else {
        expect(tool.annotations?.readOnlyHint, tool.name).toBe(false);
      }
      if (DESTRUCTIVE.has(tool.name)) {
        expect(tool.annotations?.destructiveHint, tool.name).toBe(true);
      }

      const output = tool.outputSchema as Record<string, unknown> | undefined;
      expect(output, tool.name).toBeTruthy();
      expect(output?.type, tool.name).toBe("object");
      expect(output?.anyOf, tool.name).toBeUndefined();
      expect(output?.oneOf, tool.name).toBeUndefined();
      expect(output?.allOf, tool.name).toBeUndefined();
    }
  });

  it("advertises listChanged false because this server never emits list_changed notifications", () => {
    const caps = client.getServerCapabilities();
    expect(caps?.tools?.listChanged).toBeFalsy();
    expect(caps?.resources?.listChanged).toBeFalsy();
    expect(caps?.prompts?.listChanged).toBeFalsy();
  });

  it("rejects schema-invalid input as a protocol error (-32602)", async () => {
    const result = await client.callTool({
      name: "join_session",
      arguments: { role: "" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as { type: string; text?: string }[])[0]?.text ?? "";
    expect(text).toMatch(/role/i);
  });

  it("returns tool errors instead of crashing on business-rule violations", async () => {
    // Whitespace passes the schema (min length 1) but fails core validation,
    // so it must come back as an isError tool result, not a JSON-RPC error.
    const result = await client.callTool({
      name: "join_session",
      arguments: { role: "   " },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as { type: string; text?: string }[])[0]?.text ?? "";
    const parsed = JSON.parse(text) as { error: string };
    expect(parsed.error).toMatch(/role/i);
  });

  it("returns structuredContent alongside text JSON on success", async () => {
    const result = await client.callTool({
      name: "join_session",
      arguments: { session_id: "contract-1", role: "tester", harness: "vitest" },
    });
    expect(result.isError).toBeFalsy();
    const text = (result.content as { type: string; text?: string }[])[0]?.text ?? "";
    const parsed = JSON.parse(text) as { session_id: string };
    expect(parsed.session_id).toBe("contract-1");
    expect(result.structuredContent).toMatchObject({ session_id: "contract-1" });
  });
});
