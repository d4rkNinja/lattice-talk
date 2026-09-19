import { log } from "./log.js";
import { startServer } from "./mcp/server.js";

startServer().catch((err: unknown) => {
  log("fatal", err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
