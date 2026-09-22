import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";

/**
 * Minimal newline-delimited JSON-RPC 2.0 client over a child process's
 * stdio — the shared transport for ACP agents (gemini --acp, agent acp,
 * claude-code-acp) and Codex app-server, which all speak the same framing.
 */
export class NdjsonRpc {
  private readonly proc: ChildProcess;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private readonly requestHandlers = new Map<
    string,
    (params: unknown) => Promise<unknown> | unknown
  >();
  private readonly notificationHandlers = new Map<string, (params: unknown) => void>();
  private closed = false;

  constructor(
    command: string,
    args: string[],
    opts: {
      cwd?: string;
      env?: NodeJS.ProcessEnv;
      onStderr?: (line: string) => void;
      onExit?: (code: number | null) => void;
      /** Force shell on/off — tests spawn `node` which needs no shell. */
      shell?: boolean;
    } = {},
  ) {
    this.proc = spawn(command, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ["pipe", "pipe", "pipe"],
      // Windows .cmd/.bat shims (npx, gemini) only resolve through a shell.
      shell: opts.shell ?? process.platform === "win32",
    });

    const rl = createInterface({ input: this.proc.stdout! });
    rl.on("line", (line) => this.handleLine(line));
    if (opts.onStderr && this.proc.stderr) {
      const errRl = createInterface({ input: this.proc.stderr });
      errRl.on("line", (line) => opts.onStderr!(line));
    }
    const failAll = (err: Error) => {
      this.closed = true;
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    };
    // Missing binary (ENOENT) emits 'error', not 'exit' — without this an
    // unhandled 'error' event crashes the process instead of surfacing as
    // a failed handshake.
    this.proc.on("error", (e) => {
      failAll(e);
      opts.onExit?.(null);
    });
    this.proc.on("exit", (code) => {
      failAll(new Error(`process exited with code ${code}`));
      opts.onExit?.(code);
    });
  }

  private write(msg: Record<string, unknown>): void {
    if (this.closed || !this.proc.stdin?.writable) {
      throw new Error("process is not writable");
    }
    this.proc.stdin.write(JSON.stringify(msg) + "\n");
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("{")) return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return;
    }
    // Response: has id, and result or error.
    if (typeof msg.id === "number" && ("result" in msg || "error" in msg)) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) {
        const e = msg.error as { message?: string; code?: number };
        p.reject(new Error(`${e.message ?? "request failed"} (code ${e.code ?? "?"})`));
      } else {
        p.resolve(msg.result);
      }
      return;
    }
    // Server→client request: has id + method.
    if (msg.id !== undefined && typeof msg.method === "string") {
      void this.dispatchRequest(msg.id as number, msg.method, msg.params);
      return;
    }
    // Notification: method, no id.
    if (typeof msg.method === "string") {
      this.notificationHandlers.get(msg.method)?.(msg.params);
    }
  }

  private async dispatchRequest(id: number, method: string, params: unknown): Promise<void> {
    const handler = this.requestHandlers.get(method);
    try {
      if (!handler) throw Object.assign(new Error(`unhandled method ${method}`), { code: -32601 });
      const result = await handler(params);
      this.write({ jsonrpc: "2.0", id, result: result ?? null });
    } catch (err) {
      const code = (err as { code?: number }).code ?? -32603;
      this.write({
        jsonrpc: "2.0",
        id,
        error: { code, message: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  async request<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<T> {
    const id = this.nextId++;
    let timer: NodeJS.Timeout | undefined;
    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => {
          if (timer) clearTimeout(timer);
          resolve(v as T);
        },
        reject: (e) => {
          if (timer) clearTimeout(timer);
          reject(e);
        },
      });
      if (timeoutMs !== undefined) {
        // A harness that silently drops an unknown method must not wedge the
        // caller forever — only used on bounded probes, never on prompts.
        timer = setTimeout(() => {
          if (this.pending.delete(id)) {
            reject(new Error(`${method} timed out after ${timeoutMs}ms`));
          }
        }, timeoutMs);
        timer.unref?.();
      }
    });
    try {
      this.write({ jsonrpc: "2.0", id, method, params: params ?? {} });
    } catch (e) {
      this.pending.delete(id);
      if (timer) clearTimeout(timer);
      throw e;
    }
    return promise;
  }

  notify(method: string, params?: Record<string, unknown>): void {
    this.write({ jsonrpc: "2.0", method, params: params ?? {} });
  }

  onRequest(method: string, handler: (params: unknown) => Promise<unknown> | unknown): void {
    this.requestHandlers.set(method, handler);
  }

  onNotification(method: string, handler: (params: unknown) => void): void {
    this.notificationHandlers.set(method, handler);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    try {
      this.proc.stdin?.end();
    } catch {}
    const proc = this.proc;
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        proc.kill();
        resolve();
      }, 3000);
      proc.once("exit", () => {
        clearTimeout(t);
        resolve();
      });
    });
  }
}
