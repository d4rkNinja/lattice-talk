import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryStore } from "../src/core/memory-store.js";
import { createMcpServer } from "../src/mcp/server.js";
import { setupInProcessOtel } from "../src/otel/setup.js";
import { expectToolOk, makeDeps } from "./helpers.js";

describe("OTEL mutating spans", () => {
  const otel = setupInProcessOtel();
  const store = new MemoryStore("otel");
  const deps = makeDeps(store);
  let client: Client;

  beforeAll(async () => {
    const server = createMcpServer(deps);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "otel-test", version: "0.0.1" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterAll(async () => {
    await client.close();
    await store.close();
    await otel.shutdown();
  });

  it("sets gen_ai.conversation.id to the session_id on mutating tools", async () => {
    const sessionId = "otel-session-1";
    otel.exporter.reset();

    expectToolOk(
      await client.callTool({
        name: "join_session",
        arguments: { session_id: sessionId, role: "tester", agent_id: "otel-a", harness: "vitest" },
      }),
    );
    expectToolOk(
      await client.callTool({
        name: "tell_room",
        arguments: { body: "traced hello" },
      }),
    );
    expectToolOk(
      await client.callTool({
        name: "memory_set",
        arguments: { key: "flag", value: "on" },
      }),
    );

    const spans = otel.spans();
    const mutating = spans.filter((span) =>
      ["lattice.join_session", "lattice.tell_room", "lattice.memory_set"].includes(span.name),
    );
    expect(mutating.length).toBeGreaterThanOrEqual(3);
    for (const span of mutating) {
      expect(span.attributes["gen_ai.conversation.id"], span.name).toBe(sessionId);
    }
  });
});
