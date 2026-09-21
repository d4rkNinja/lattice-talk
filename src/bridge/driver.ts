/**
 * A harness driver spawns an agent through its programmatic interface and
 * injects Lattice bus messages into that running session. The agent talks
 * back through the normal lattice MCP tools — the bridge only pushes in.
 */
export interface DriverOpts {
  /** Working directory the agent session runs in. */
  cwd: string;
  /** Extra env for the spawned process (LATTICE_* credentials etc.). */
  env: NodeJS.ProcessEnv;
  /** ACP-style MCP server specs to register into the spawned session. */
  mcpServers: AcpMcpServer[];
  /** Sent once the session is ready — tells the agent to join the bus. */
  initialPrompt: string;
  /** Human-readable event stream (stderr, session updates) for the user. */
  onEvent?: (line: string) => void;
}

export interface HarnessDriver {
  readonly id: string;
  start(opts: DriverOpts): Promise<void>;
  /** Inject a user-visible message into the running session. */
  send(text: string): Promise<void>;
  close(): Promise<void>;
}

/** ACP `session/new` mcpServers entry. */
export interface AcpMcpServer {
  name: string;
  command: string;
  args: string[];
  env: { name: string; value: string }[];
}

export const BRIDGE_HARNESSES = ["claude", "codex", "gemini", "cursor"] as const;
export type BridgeHarness = (typeof BRIDGE_HARNESSES)[number];

export function isBridgeHarness(id: string): id is BridgeHarness {
  return (BRIDGE_HARNESSES as readonly string[]).includes(id);
}
