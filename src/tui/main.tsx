import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./App.js";

// Spawned as a child process by `lattice-talk` / `lattice-talk tui|setup`
// (see src/cli.ts) — OpenTUI's native renderer needs Bun or Node >= 26.4,
// which is why it never shares a process with the MCP stdio server.
const forceSetup = process.argv.slice(2).includes("--setup");

const renderer = await createCliRenderer({ exitOnCtrlC: false });
createRoot(renderer).render(<App forceSetup={forceSetup} />);
