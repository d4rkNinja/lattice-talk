import { existsSync } from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, describe, expect, it } from "vitest";
import { expectToolOk } from "./helpers.js";

const redisUrl = process.env.LATTICE_REDIS_URL;
const distEntry = path.resolve("dist/index.js");

describe.skipIf(!redisUrl || !existsSync(distEntry))("two-process Redis stdio E2E", () => {
  const clients: Client[] = [];
  const transports: StdioClientTransport[] = [];

  afterAll(async () => {
    await Promise.all(clients.map((c) => c.close()));
    await Promise.all(transports.map((t) => t.close()));
  });

  async function spawnAgent(name: string): Promise<Client> {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [distEntry],
      env: {
        ...getDefaultEnvironment(),
        LATTICE_STORE: "redis",
        LATTICE_NAMESPACE: "e2e-stdio",
        LATTICE_REDIS_URL: redisUrl ?? "",
      },
      stderr: "pipe",
    });
    const client = new Client({ name, version: "0.0.1" });
    await client.connect(transport);
    transports.push(transport);
    clients.push(client);
    return client;
  }

  it(
    "A and B join, tell_room / pull_messages, and share memory over Redis",
    async () => {
      const sessionId = `e2e-${Date.now()}`;
      const a = await spawnAgent("lattice-e2e-a");
      const b = await spawnAgent("lattice-e2e-b");

      const joinedA = expectToolOk<{ session_id: string; agent_id: string }>(
        await a.callTool({
          name: "join_session",
          arguments: { session_id: sessionId, role: "frontend", agent_id: "e2e-a", harness: "vitest" },
        }),
      );
      const joinedB = expectToolOk<{ session_id: string; agent_id: string }>(
        await b.callTool({
          name: "join_session",
          arguments: { session_id: sessionId, role: "backend", agent_id: "e2e-b", harness: "vitest" },
        }),
      );
      expect(joinedA.session_id).toBe(sessionId);
      expect(joinedB.session_id).toBe(sessionId);

      expectToolOk(
        await a.callTool({
          name: "tell_room",
          arguments: { body: "hello from A" },
        }),
      );
      const pulled = expectToolOk<{ messages: { body: string; from: string }[] }>(
        await b.callTool({
          name: "pull_messages",
          arguments: { room_id: "main" },
        }),
      );
      expect(pulled.messages.some((m) => m.body === "hello from A" && m.from === "e2e-a")).toBe(
        true,
      );

      expectToolOk(
        await a.callTool({
          name: "memory_set",
          arguments: { key: "shared.flag", value: "on" },
        }),
      );
      const got = expectToolOk<{ value: string | null; found: boolean }>(
        await b.callTool({
          name: "memory_get",
          arguments: { key: "shared.flag" },
        }),
      );
      expect(got.found).toBe(true);
      expect(got.value).toBe("on");
    },
    30_000,
  );
});
