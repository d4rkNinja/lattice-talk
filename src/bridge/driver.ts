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
  /**
   * Supervisor respawn: when set, the driver should try to resume this
   * harness-side session (ACP session/load or session/resume, Codex
   * thread/resume) instead of opening a fresh one, so the agent keeps its
   * context. Drivers fall back to a new session when the harness can't
   * resume. The join prompt is still sent — the respawned MCP process must
   * re-register its identity.
   */
  resumeRef?: string;
  /** Human-readable event stream (stderr, session updates) for the user. */
  onEvent?: (line: string) => void;
  /** Fires when the agent process exits — the bridge shuts down with it. */
  onExit?: (code: number | null) => void;
}

export interface HarnessDriver {
  readonly id: string;
  /**
   * Harness-side session identifier usable as DriverOpts.resumeRef on a
   * later spawn — ACP sessionId, Codex threadId. Undefined when the harness
   * exposes none.
   */
  readonly sessionRef?: string;
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

export const BRIDGE_HARNESSES = ["claude", "codex", "gemini", "cursor", "grok"] as const;
export type BridgeHarness = (typeof BRIDGE_HARNESSES)[number];

export function isBridgeHarness(id: string): id is BridgeHarness {
  return (BRIDGE_HARNESSES as readonly string[]).includes(id);
}
