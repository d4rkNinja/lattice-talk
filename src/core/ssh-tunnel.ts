import { spawn, type ChildProcess } from "node:child_process";
import { createConnection, createServer } from "node:net";
import type { LatticeConfig } from "./config.js";

/**
 * SSH local port-forwarding for Redis targets that sit behind a bastion.
 *
 * Configured purely through env/config file (no TUI fields): LATTICE_SSH_HOST
 * triggers it; LATTICE_SSH_PORT (22), LATTICE_SSH_USER, LATTICE_SSH_KEY,
 * LATTICE_SSH_LOCAL_PORT refine it. Auth relies on the user's ssh agent,
 * keys, or ~/.ssh/config — BatchMode keeps a missing passphrase from hanging
 * the headless `ssh -N` process instead of prompting on a hidden tty.
 */

export interface SshTunnel {
  localPort: number;
  target: string;
  close(): Promise<void>;
}

export function buildSshArgs(config: LatticeConfig, localPort: number, targetHost: string, targetPort: number): string[] {
  const args = [
    "-N",
    "-T",
    "-o", "BatchMode=yes",
    "-o", "ExitOnForwardFailure=yes",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=2",
    "-L", `127.0.0.1:${localPort}:${targetHost}:${targetPort}`,
  ];
  if (config.sshPort && config.sshPort !== 22) args.push("-p", String(config.sshPort));
  if (config.sshKey) args.push("-i", config.sshKey);
  const userHost = config.sshUser ? `${config.sshUser}@${config.sshHost}` : config.sshHost!;
  args.push(userHost);
  return args;
}

/** Grab an ephemeral loopback port the OS guarantees is free right now. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!port) throw new Error("could not allocate a local port for the SSH tunnel");
  return port;
}

function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() >= deadline) {
          reject(new Error("SSH tunnel did not become ready in time"));
        } else {
          setTimeout(attempt, 120);
        }
      });
    };
    attempt();
  });
}

/**
 * Resolve the Redis host/port the tunnel should forward to, then return a
 * config whose redisUrl points at the local tunnel endpoint. Credentials and
 * db index from the original target are preserved; TLS is dropped — the SSH
 * channel already encrypts the hop, and rediss would fail certificate
 * hostname checks against 127.0.0.1 anyway.
 */
export function tunneledConfig(config: LatticeConfig, localPort: number): LatticeConfig {
  let auth = "";
  let db = "";
  if (config.redisUrl) {
    try {
      const url = new URL(config.redisUrl);
      const user = decodeURIComponent(url.username);
      const pass = decodeURIComponent(url.password);
      if (user || pass) auth = `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@`;
      if (url.pathname && url.pathname !== "/") db = url.pathname;
    } catch {
      // Malformed URL — fall through to the host/port path below.
    }
  } else {
    const user = config.redisUsername;
    const pass = config.redisPassword;
    if (user || pass) {
      auth = `${encodeURIComponent(user ?? "")}:${encodeURIComponent(pass ?? "")}@`;
    }
    if (config.redisDb) db = `/${config.redisDb}`;
  }
  return {
    ...config,
    redisUrl: `redis://${auth}127.0.0.1:${localPort}${db}`,
    redisSsl: false,
  };
}

export function tunnelTarget(config: LatticeConfig): { host: string; port: number } {
  if (config.redisUrl) {
    try {
      const url = new URL(config.redisUrl);
      return { host: url.hostname, port: Number.parseInt(url.port, 10) || 6379 };
    } catch {
      // fall through
    }
  }
  return { host: config.redisHost ?? "127.0.0.1", port: config.redisPort };
}

/**
 * Open `ssh -N -L` and wait until the local endpoint accepts connections.
 * Returns undefined when SSH tunneling isn't configured. Throws a friendly
 * error when ssh is missing, auth fails, or the forward never comes up.
 */
export async function openSshTunnel(
  config: LatticeConfig,
  options?: { timeoutMs?: number },
): Promise<SshTunnel | undefined> {
  if (!config.sshHost) return undefined;
  const target = tunnelTarget(config);
  const localPort = config.sshLocalPort || (await freePort());
  const args = buildSshArgs(config, localPort, target.host, target.port);

  let proc: ChildProcess;
  try {
    proc = spawn("ssh", args, { stdio: ["ignore", "ignore", "pipe"] });
  } catch (e) {
    throw new Error(
      `SSH tunnel requested (LATTICE_SSH_HOST) but spawning ssh failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  let stderrTail = "";
  proc.stderr?.on("data", (chunk) => {
    stderrTail = (stderrTail + String(chunk)).slice(-2000);
  });

  const spawnError = new Promise<never>((_, reject) => {
    proc.once("error", () =>
      reject(
        new Error(
          "SSH tunnel requested (LATTICE_SSH_HOST) but `ssh` is not on PATH. " +
            "Install an OpenSSH client (built into Windows 10+ via Optional Features) " +
            "or unset LATTICE_SSH_HOST.",
        ),
      ),
    );
    proc.once("exit", (code) =>
      reject(
        new Error(
          `ssh exited before the tunnel was ready (code ${code}).` +
            (stderrTail.trim() ? ` ssh says: ${stderrTail.trim().split("\n").pop()}` : "") +
            " Check LATTICE_SSH_HOST/USER/KEY — authentication must work non-interactively (ssh-agent or key file).",
        ),
      ),
    );
  });

  try {
    await Promise.race([waitForPort(localPort, options?.timeoutMs ?? 10_000), spawnError]);
  } catch (e) {
    proc.kill();
    throw e;
  }

  return {
    localPort,
    target: `${target.host}:${target.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        if (proc.exitCode !== null || proc.killed) return resolve();
        proc.once("exit", () => resolve());
        proc.kill();
        setTimeout(resolve, 2000).unref();
      }),
  };
}
