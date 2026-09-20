import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/client/stdio";
import { afterAll, describe, expect, it } from "vitest";
import {
  CLAUDE_CODE_PROPERTY_NAME,
  SERVER_INSTRUCTIONS,
} from "../src/mcp/instructions.js";

const distEntry = path.resolve("dist/index.js");

describe.skipIf(!existsSync(distEntry))("built stdio MCP server", () => {
  let client: Client | undefined;
  let transport: StdioClientTransport | undefined;

  afterAll(async () => {
    await client?.close();
    await transport?.close();
  });

  it("writes startup logs only to stderr (stdout stays empty until MCP)", async () => {
    const child = spawn(process.execPath, [distEntry], {
      env: {
        ...getDefaultEnvironment(),
        LATTICE_STORE: "memory",
        LATTICE_NAMESPACE: "smoke-stderr",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`no stderr banner; stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`));
      }, 8_000);
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
        if (stderr.includes("[lattice-talk]")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.once("exit", (code) => {
        if (!stderr.includes("[lattice-talk]")) {
          clearTimeout(timer);
          reject(new Error(`exited ${code} before logging; stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`));
        }
      });
    });
    child.kill();
    await new Promise<void>((resolve) => {
      child.once("close", () => resolve());
    });
    expect(stdout, "stdout must stay empty until a client speaks MCP").toBe("");
    expect(stderr).toMatch(/\[lattice-talk\]/);
  });

  it("runs over stdio, lists flat annotated tools, and joins a memory-store session", async () => {
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [distEntry],
      env: {
        ...getDefaultEnvironment(),
        LATTICE_STORE: "memory",
        LATTICE_NAMESPACE: "smoke",
      },
      stderr: "pipe",
    });
    client = new Client({ name: "lattice-smoke", version: "0.0.1" });
    await client.connect(transport);

    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);

    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
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
      ].sort(),
    );

    for (const tool of listed.tools) {
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
    }

    const joined = await client.callTool({
      name: "join_session",
      arguments: { session_id: "smoke-1", role: "tester", harness: "vitest" },
    });
    expect(joined.isError).toBeFalsy();
    const text = (joined.content as { type: string; text?: string }[])[0]?.text ?? "";
    const body = JSON.parse(text) as { session_id: string; agent_id: string };
    expect(body.session_id).toBe("smoke-1");
    expect(body.agent_id).toBeTruthy();
  });
});
