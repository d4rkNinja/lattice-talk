import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryStore } from "../src/core/memory-store.js";
import { memorySet } from "../src/core/memory.js";
import { ABOUT_RESOURCE_URI, MEMORY_URI_TEMPLATE, SESSION_URI_TEMPLATE } from "../src/mcp/uris.js";
import { createMcpServer } from "../src/mcp/server.js";
import { makeDeps, testConfig } from "./helpers.js";

describe("MCP resources and prompts", () => {
  let client: Client;
  let server: McpServer;
  let store: MemoryStore;

  beforeAll(async () => {
    store = new MemoryStore("primitives");
    const deps = makeDeps(store, testConfig({ LATTICE_DEFAULT_SESSION_ID: "demo-1" }));
    await memorySet(deps, { session_id: "demo-1", key: "api.base", value: "https://api.dev" });
    server = createMcpServer(deps);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "lattice-primitives", version: "0.0.1" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterAll(async () => {
    await client.close();
    await server.close();
    await store.close();
  });

  it("lists about plus default-session resources and the two templates", async () => {
    const listed = await client.listResources();
    const uris = listed.resources.map((r) => r.uri).sort();
    expect(uris).toContain(ABOUT_RESOURCE_URI);
    expect(uris).toContain("lattice://session/demo-1");
    expect(uris).toContain("lattice://session/demo-1/memory");

    const templates = await client.listResourceTemplates();
    const patterns = templates.resourceTemplates.map((t) => t.uriTemplate).sort();
    expect(patterns).toEqual([MEMORY_URI_TEMPLATE, SESSION_URI_TEMPLATE].sort());
  });

  it("reads about without leaking Redis secrets", async () => {
    const read = await client.readResource({ uri: ABOUT_RESOURCE_URI });
    const text = read.contents[0] && "text" in read.contents[0] ? read.contents[0].text : "";
    expect(read.contents[0]?.mimeType).toBe("application/json");
    const body = JSON.parse(text ?? "") as {
      name: string;
      transport: string;
      spec: string;
    };
    expect(body.name).toBe("lattice-talk");
    expect(body.transport).toBe("stdio");
    expect(body.spec).toBe("2026-07-28");
    expect(text).not.toMatch(/password|redis:\/\//i);
  });

  it("reads session and memory templates", async () => {
    const session = await client.readResource({ uri: "lattice://session/demo-1" });
    const sessionText =
      session.contents[0] && "text" in session.contents[0] ? session.contents[0].text : "";
    const sessionBody = JSON.parse(sessionText ?? "") as { session_id: string; namespace: string };
    expect(sessionBody.session_id).toBe("demo-1");
    expect(sessionBody.namespace).toBe("test");

    const memory = await client.readResource({ uri: "lattice://session/demo-1/memory" });
    const memoryText =
      memory.contents[0] && "text" in memory.contents[0] ? memory.contents[0].text : "";
    const memoryBody = JSON.parse(memoryText ?? "") as { keys: string[] };
    expect(memoryBody.keys).toContain("api.base");
  });

  it("rejects unknown and invalid resource URIs", async () => {
    await expect(client.readResource({ uri: "lattice://nope" })).rejects.toThrow();
    await expect(client.readResource({ uri: "lattice://session/!!bad!!" })).rejects.toThrow();
  });

  it("lists and gets user-controlled prompts without secret args", async () => {
    const listed = await client.listPrompts();
    const names = listed.prompts.map((p) => p.name).sort();
    expect(names).toEqual(["join-session", "pull-and-reply", "two-agent-handoff"]);

    for (const prompt of listed.prompts) {
      for (const arg of prompt.arguments ?? []) {
        expect(arg.name).not.toMatch(/password|redis_url|credential/i);
      }
    }

    const got = await client.getPrompt({
      name: "join-session",
      arguments: { session_id: "demo-1", role: "frontend" },
    });
    const text = got.messages[0]?.content.type === "text" ? got.messages[0].content.text : "";
    expect(text).toMatch(/join_session/);
    expect(text).toMatch(/demo-1/);
    expect(text).toMatch(/frontend/);
    expect(text).not.toMatch(/REDIS_PASSWORD/);
  });
});
