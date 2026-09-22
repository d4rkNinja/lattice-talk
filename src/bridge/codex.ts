import { NdjsonRpc } from "./ndjson-rpc.js";
import type { DriverOpts, HarnessDriver } from "./driver.js";

/**
 * Codex driver — `codex app-server` is OpenAI's experimental JSON-RPC stdio
 * interface. `turn/steer` is the official way to add input to an in-flight
 * turn; `turn/start` opens a fresh turn on the thread. MCP servers come from
 * Codex's own config (`lattice-talk mcp add codex`).
 */
export class CodexDriver implements HarnessDriver {
  readonly id = "codex";
  private readonly command: string;
  private readonly args: string[];
  private readonly shell?: boolean;
  private rpc?: NdjsonRpc;
  private threadId = "";
  private activeTurnId: string | null = null;
  private sendQueue: Promise<unknown> = Promise.resolve();

  get sessionRef(): string | undefined {
    return this.threadId || undefined;
  }

  constructor(command = "codex", args = ["app-server"], shell?: boolean) {
    this.command = command;
    this.args = args;
    this.shell = shell;
  }

  async start(opts: DriverOpts): Promise<void> {
    const onEvent = opts.onEvent ?? (() => {});
    const rpc = new NdjsonRpc(this.command, this.args, {
      cwd: opts.cwd,
      env: opts.env,
      shell: this.shell,
      onStderr: (line) => onEvent(`[codex] ${line}`),
      onExit: (code) => {
        onEvent(`[codex] exited (code ${code ?? "?"})`);
        opts.onExit?.(code);
      },
    });
    this.rpc = rpc;

    rpc.onNotification("turn/started", (params) => {
      this.activeTurnId =
        (params as { turn?: { id?: string }; turnId?: string })?.turn?.id ??
        (params as { turnId?: string })?.turnId ??
        this.activeTurnId;
    });
    rpc.onNotification("turn/completed", () => {
      this.activeTurnId = null;
    });
    for (const m of ["item/agentMessage/delta", "codex/event/agent_message_delta"]) {
      rpc.onNotification(m, (params) => {
        const delta = (params as { delta?: string })?.delta?.trimEnd();
        if (delta) onEvent(`[codex] ${delta}`);
      });
    }

    try {
      await rpc.request("initialize", {
        clientInfo: { name: "lattice-talk-bridge", version: "0" },
      });
      rpc.notify("notifications/initialized");
      this.threadId = await this.openThread(rpc, opts);
    } catch (err) {
      throw new Error(
        `Could not start a Codex app-server session (${err instanceof Error ? err.message : err}). ` +
          "Make sure `codex` is installed and authenticated.",
      );
    }
    if (!this.threadId) throw new Error("Codex app-server returned no thread id");

    await this.send(opts.initialPrompt);
  }

  /**
   * Respawn path: thread/resume re-hydrates the persisted thread so a woken
   * agent keeps its context; older app-servers without it fall back to a
   * fresh thread (the join prompt re-registers the bus identity).
   */
  private async openThread(rpc: NdjsonRpc, opts: DriverOpts): Promise<string> {
    if (opts.resumeRef) {
      try {
        await rpc.request("thread/resume", {
          threadId: opts.resumeRef,
          cwd: opts.cwd,
        });
        return opts.resumeRef;
      } catch {
        opts.onEvent?.(
          `[codex] could not resume ${opts.resumeRef} — starting a fresh thread`,
        );
      }
    }
    const res = (await rpc.request("thread/start", {
      cwd: opts.cwd,
      experimentalRawEvents: false,
    })) as { thread?: { id?: string } };
    return res?.thread?.id ?? "";
  }

  send(text: string): Promise<void> {
    const input = [{ type: "text", text }];
    const run = this.sendQueue.then(async () => {
      // Prefer steering an in-flight turn — that's the delivery Codex built
      // for external input; otherwise open a new turn.
      if (this.activeTurnId) {
        try {
          await this.rpc!.request("turn/steer", {
            threadId: this.threadId,
            input,
          });
          return;
        } catch {
          // Steer failed (turn may have just finished) — fall through.
        }
      }
      await this.rpc!.request("turn/start", { threadId: this.threadId, input });
    });
    this.sendQueue = run.catch(() => {});
    return run;
  }

  async close(): Promise<void> {
    const rpc = this.rpc;
    this.rpc = undefined;
    await rpc?.close();
  }
}
