import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "../core/config.js";
import { RuntimeContext } from "../core/context.js";
import { createStore, type Store } from "../core/store.js";
import type { BusDeps } from "../core/types.js";
import { log } from "../log.js";
import { installOtelStderrLogger, setupOtel, type OtelHandle } from "../otel/setup.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../version.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";
import { registerMemoryTools } from "./tools/memory.js";
import { registerMessagingTools } from "./tools/messaging.js";
import { registerObservabilityTools } from "./tools/observability.js";
import { registerSessionTools } from "./tools/session.js";

export function createMcpServer(deps: BusDeps): McpServer {
  const server = new McpServer(
    {
      name: PACKAGE_NAME,
      version: PACKAGE_VERSION,
    },
    {
      instructions: SERVER_INSTRUCTIONS,
    },
  );
  registerSessionTools(server, deps);
  registerMessagingTools(server, deps);
  registerMemoryTools(server, deps);
  registerObservabilityTools(server, deps);
  return server;
}

export async function startServer(): Promise<void> {
  installOtelStderrLogger();
  const config = loadConfig();
  const otel = setupOtel(config);
  let store: Store;
  try {
    store = await createStore(config);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log("failed to create store:", message);
    process.exit(1);
  }

  const deps: BusDeps = {
    store,
    config,
    ctx: new RuntimeContext(),
  };
  const server = createMcpServer(deps);
  const transport = new StdioServerTransport();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${signal}, shutting down`);
    try {
      await store.close();
    } catch (err) {
      log("store close error", err instanceof Error ? err.message : err);
    }
    try {
      await otel.shutdown();
    } catch (err) {
      log("otel shutdown error", err instanceof Error ? err.message : err);
    }
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  log(
    `starting store=${store.kind} namespace=${config.namespace} otel=${otel.enabled ? "on" : "off"}`,
  );
  await server.connect(transport);
}

export type { OtelHandle };
