import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/core/config.js";
import {
  buildSshArgs,
  openSshTunnel,
  tunneledConfig,
  tunnelTarget,
} from "../src/core/ssh-tunnel.js";
import {
  connectionToEnv,
  connectionToHarnessEnv,
  loadFileConfig,
  resolveConnection,
  saveFileConfig,
} from "../src/cli/config-file.js";

const tmpDirs: string[] = [];

function tmpHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "lattice-ssh-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe("ssh tunnel config", () => {
  it("parses LATTICE_SSH_* env vars", () => {
    const config = loadConfig({
      LATTICE_REDIS_URL: "redis://10.0.0.5:6380",
      LATTICE_SSH_HOST: "bastion.example.com",
      LATTICE_SSH_PORT: "2222",
      LATTICE_SSH_USER: "deploy",
      LATTICE_SSH_KEY: "C:\\keys\\id_ed25519",
    } as NodeJS.ProcessEnv);
    expect(config.sshHost).toBe("bastion.example.com");
    expect(config.sshPort).toBe(2222);
    expect(config.sshUser).toBe("deploy");
    expect(config.sshKey).toBe("C:\\keys\\id_ed25519");
  });

  it("defaults ssh port to 22 and rejects bad ports", () => {
    const config = loadConfig({
      LATTICE_REDIS_URL: "redis://h:6379",
      LATTICE_SSH_HOST: "b",
    } as NodeJS.ProcessEnv);
    expect(config.sshPort).toBe(22);
    expect(() =>
      loadConfig({ LATTICE_SSH_HOST: "b", LATTICE_SSH_PORT: "nope" } as NodeJS.ProcessEnv),
    ).toThrow(/LATTICE_SSH_PORT/);
  });
});

describe("buildSshArgs", () => {
  const base = loadConfig({
    LATTICE_REDIS_URL: "redis://10.0.0.5:6380",
    LATTICE_SSH_HOST: "bastion.example.com",
  } as NodeJS.ProcessEnv);

  it("builds a non-interactive local forward", () => {
    const args = buildSshArgs(base, 16379, "10.0.0.5", 6380);
    expect(args).toContain("-N");
    expect(args).toContain("-L");
    expect(args).toContain("127.0.0.1:16379:10.0.0.5:6380");
    expect(args[args.length - 1]).toBe("bastion.example.com");
    // BatchMode: never hang a headless process on a password prompt.
    expect(args.join(" ")).toContain("BatchMode=yes");
    expect(args.join(" ")).toContain("ExitOnForwardFailure=yes");
    expect(args.join(" ")).not.toContain("-p 22 ");
  });

  it("adds user, custom port, and identity file", () => {
    const config = loadConfig({
      LATTICE_REDIS_URL: "redis://h:6379",
      LATTICE_SSH_HOST: "bastion",
      LATTICE_SSH_PORT: "2222",
      LATTICE_SSH_USER: "deploy",
      LATTICE_SSH_KEY: "/home/u/.ssh/id_ed25519",
    } as NodeJS.ProcessEnv);
    const args = buildSshArgs(config, 16379, "h", 6379).join(" ");
    expect(args).toContain("-p 2222");
    expect(args).toContain("-i /home/u/.ssh/id_ed25519");
    expect(args).toContain("deploy@bastion");
  });
});

describe("tunnelTarget + tunneledConfig", () => {
  it("extracts the redis target from a URL", () => {
    const config = loadConfig({
      LATTICE_REDIS_URL: "redis://:secret@redis.internal:6380/3",
      LATTICE_SSH_HOST: "b",
    } as NodeJS.ProcessEnv);
    expect(tunnelTarget(config)).toEqual({ host: "redis.internal", port: 6380 });
  });

  it("falls back to REDIS_HOST/PORT when no URL is set", () => {
    const config = loadConfig({
      REDIS_HOST: "redis.internal",
      REDIS_PORT: "6385",
      LATTICE_SSH_HOST: "b",
    } as NodeJS.ProcessEnv);
    expect(tunnelTarget(config)).toEqual({ host: "redis.internal", port: 6385 });
  });

  it("rewrites redisUrl to the local endpoint, preserving auth and db", () => {
    const config = loadConfig({
      LATTICE_REDIS_URL: "redis://alice:s3cret@redis.internal:6380/3",
      LATTICE_SSH_HOST: "b",
    } as NodeJS.ProcessEnv);
    const out = tunneledConfig(config, 16379);
    expect(out.redisUrl).toBe("redis://alice:s3cret@127.0.0.1:16379/3");
    expect(out.redisSsl).toBe(false);
  });

  it("carries REDIS_USERNAME/PASSWORD into the tunnel URL for host/port mode", () => {
    const config = loadConfig({
      REDIS_HOST: "redis.internal",
      REDIS_USERNAME: "svc",
      REDIS_PASSWORD: "pw",
      REDIS_DB: "2",
      LATTICE_SSH_HOST: "b",
    } as NodeJS.ProcessEnv);
    const out = tunneledConfig(config, 16379);
    expect(out.redisUrl).toBe("redis://svc:pw@127.0.0.1:16379/2");
  });

  it("downgrades rediss:// — TLS inside an SSH tunnel breaks on the 127.0.0.1 hostname", () => {
    const config = loadConfig({
      LATTICE_REDIS_URL: "rediss://:pw@redis.internal:6380",
      LATTICE_SSH_HOST: "b",
    } as NodeJS.ProcessEnv);
    const out = tunneledConfig(config, 16379);
    expect(out.redisUrl).toBe("redis://:pw@127.0.0.1:16379");
    expect(out.redisSsl).toBe(false);
  });
});

describe("openSshTunnel", () => {
  it("does nothing without LATTICE_SSH_HOST", async () => {
    const config = loadConfig({ LATTICE_REDIS_URL: "redis://h:6379" } as NodeJS.ProcessEnv);
    expect(await openSshTunnel(config)).toBeUndefined();
  });
});

describe("ssh fields through the config file and harness env", () => {
  it("round-trips ssh fields in ~/.lattice/config.json", () => {
    const home = tmpHome();
    const path = saveFileConfig(
      {
        redisUrl: "redis://10.0.0.5:6379",
        sshHost: "bastion.example.com",
        sshPort: "2222",
        sshUser: "deploy",
        sshKey: "~/.ssh/id_ed25519",
      },
      {},
      home,
    );
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({
      sshHost: "bastion.example.com",
      sshPort: "2222",
    });
    const { config } = loadFileConfig({}, home);
    expect(config.sshUser).toBe("deploy");
    const conn = resolveConnection(config, {});
    expect(conn.sshHost).toBe("bastion.example.com");
    expect(conn.sshKey).toBe("~/.ssh/id_ed25519");
  });

  it("env overrides file values", () => {
    const home = tmpHome();
    saveFileConfig({ sshHost: "file-host" }, {}, home);
    const { config } = loadFileConfig({}, home);
    const conn = resolveConnection(config, { LATTICE_SSH_HOST: "env-host" } as NodeJS.ProcessEnv);
    expect(conn.sshHost).toBe("env-host");
  });

  it("connectionToEnv emits LATTICE_SSH_* and harness env propagates them", () => {
    const env = connectionToEnv({
      namespace: "dev",
      redisUrl: "redis://h:6379",
      sshHost: "bastion",
      sshUser: "deploy",
    });
    expect(env.LATTICE_SSH_HOST).toBe("bastion");
    expect(env.LATTICE_SSH_USER).toBe("deploy");

    const harnessEnv = connectionToHarnessEnv(
      { namespace: "dev", redisUrl: "redis://h:6379" },
      { LATTICE_SSH_HOST: "raw-env-host", LATTICE_SSH_KEY: "/k" } as NodeJS.ProcessEnv,
    );
    expect(harnessEnv.LATTICE_SSH_HOST).toBe("raw-env-host");
    expect(harnessEnv.LATTICE_SSH_KEY).toBe("/k");
  });
});
