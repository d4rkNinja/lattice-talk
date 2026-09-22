import { NdjsonRpc } from "./ndjson-rpc.js";
import type { AcpMcpServer, DriverOpts, HarnessDriver } from "./driver.js";

interface AcpSpec {
  command: string;
  args: string[];
  /** Shown in errors when the binary is missing. */
  installHint: string;
}

/**
 * Agent Client Protocol driver — one implementation covers every harness
 * that speaks ACP over stdio. Claude rides through Zed's official adapter;
 * Gemini CLI and Cursor ship native `--acp` modes.
 */
export const ACP_SPECS: Record<string, AcpSpec> = {
  claude: {
    command: "npx",
    args: ["-y", "@zed-industries/claude-code-acp"],
    installHint: "requires `claude` (Claude Code) installed and logged in",
  },
  gemini: {
    command: "gemini",
    args: ["--acp"],
    installHint: "requires `gemini` (Gemini CLI) installed and logged in",
  },
  cursor: {
    command: "agent",
    args: ["acp"],
    installHint: "requires `agent` (Cursor CLI) installed and logged in",
  },
};

const ACP_PROTOCOL_VERSION = 1;

export class AcpDriver implements HarnessDriver {
  readonly id: string;
  private readonly spec: AcpSpec;
  private readonly shell?: boolean;
  private rpc?: NdjsonRpc;
  private sessionId = "";
  private sendQueue: Promise<unknown> = Promise.resolve();

  get sessionRef(): string | undefined {
    return this.sessionId || undefined;
  }

  constructor(id: string, spec: AcpSpec, shell?: boolean) {
    this.id = id;
    this.spec = spec;
    this.shell = shell;
  }

  async start(opts: DriverOpts): Promise<void> {
    const onEvent = opts.onEvent ?? (() => {});
    const rpc = new NdjsonRpc(this.spec.command, this.spec.args, {
      cwd: opts.cwd,
      env: opts.env,
      shell: this.shell,
      onStderr: (line) => onEvent(`[${this.id}] ${line}`),
      onExit: (code) => {
        onEvent(`[${this.id}] exited (code ${code ?? "?"})`);
        opts.onExit?.(code);
      },
    });
    this.rpc = rpc;

    // Auto-approve tool permissions so the bridged agent can work unattended.
    rpc.onRequest("session/request_permission", (params) => {
      const options =
        (params as { options?: { optionId?: string; name?: string }[] })?.options ?? [];
      const allow =
        options.find((o) => /allow/i.test(o.optionId ?? o.name ?? "")) ?? options[0];
      return { outcome: { outcome: "selected", optionId: allow?.optionId } };
    });
    // We advertise no fs/terminal capabilities — the agent uses its own tools.
    for (const m of [
      "fs/read_text_file",
      "fs/write_text_file",
      "terminal/create",
      "terminal/output",
      "terminal/release",
      "terminal/kill",
      "terminal/wait_for_exit",
    ]) {
      rpc.onRequest(m, () => {
        throw Object.assign(new Error("client provides no fs/terminal capability"), {
          code: -32601,
        });
      });
    }
    rpc.onNotification("session/update", (params) => {
      const update = (params as { update?: { sessionUpdate?: string; content?: { type?: string; text?: string } } })
        ?.update;
      if (update?.sessionUpdate === "agent_message_chunk" && update.content?.type === "text") {
        const text = update.content.text?.trimEnd();
        if (text) onEvent(`[${this.id}] ${text}`);
      }
    });

    let init: { authMethods?: { id: string }[] } | undefined;
    try {
      init = (await rpc.request("initialize", {
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
        clientInfo: { name: "lattice-talk-bridge", version: "0" },
      })) as { authMethods?: { id: string }[] };
      this.sessionId = await this.openSession(rpc, opts);
    } catch (err) {
      const auth = init?.authMethods?.[0]?.id;
      throw new Error(
        `Could not start a ${this.id} session (${err instanceof Error ? err.message : err}). ` +
          `Make sure ${this.spec.installHint}.` +
          (auth ? ` Agent advertises auth method "${auth}".` : ""),
      );
    }
    if (!this.sessionId) throw new Error(`${this.id} returned no sessionId`);

    await this.send(opts.initialPrompt);
  }

  /**
   * Respawn path: try session/resume (no replay) then session/load (full
   * replay) so a woken agent keeps its context. Agents that can't resume
   * either fall through to session/new. Errors are swallowed — the caller's
   * join prompt re-establishes identity on a fresh session regardless.
   */
  private async openSession(rpc: NdjsonRpc, opts: DriverOpts): Promise<string> {
    const mcpServers = opts.mcpServers.map(serializeMcpServer);
    if (opts.resumeRef) {
      for (const method of ["session/resume", "session/load"] as const) {
        try {
          await rpc.request(method, {
            sessionId: opts.resumeRef,
            cwd: opts.cwd,
            mcpServers,
          });
          return opts.resumeRef;
        } catch {
          // capability absent or session gone — try the next mechanism
        }
      }
      opts.onEvent?.(`[${this.id}] could not resume ${opts.resumeRef} — starting a fresh session`);
    }
    const res = (await rpc.request("session/new", {
      cwd: opts.cwd,
      mcpServers,
    })) as { sessionId?: string };
    return res.sessionId ?? "";
  }

  /** Serialized prompts — ACP sessions process input one turn at a time. */
  send(text: string): Promise<void> {
    const run = this.sendQueue.then(() =>
      this.rpc!.request("session/prompt", {
        sessionId: this.sessionId,
        prompt: [{ type: "text", text }],
      }),
    );
    this.sendQueue = run.catch(() => {});
    return run.then(() => {});
  }

  async close(): Promise<void> {
    const rpc = this.rpc;
    this.rpc = undefined;
    if (rpc) {
      try {
        if (this.sessionId) await rpc.request("session/cancel", { sessionId: this.sessionId });
      } catch {}
      await rpc.close();
    }
  }
}

function serializeMcpServer(s: AcpMcpServer): Record<string, unknown> {
  return { name: s.name, command: s.command, args: s.args, env: s.env };
}
