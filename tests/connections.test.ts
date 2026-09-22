import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadFileConfig,
  resolveConnection,
  saveFileConfig,
} from "../src/cli/config-file.js";
import {
  activateProfile,
  assertProfileName,
  connectionFromFlags,
  deleteProfile,
  describeConnection,
  listProfiles,
  parseSshTarget,
  saveProfile,
} from "../src/cli/connections.js";

const tmpDirs: string[] = [];

function tmpHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "lattice-conn-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe("connection profiles", () => {
  it("saveProfile stores the profile and mirrors it into the flat fields", () => {
    const home = tmpHome();
    saveProfile(
      "office",
      {
        redisUrl: "redis://:s3cret@redis.internal:6380/2",
        namespace: "prod",
        workspace: "api",
        joinToken: "tok",
        sshHost: "bastion.example.com",
        sshUser: "deploy",
        sshPort: "2222",
      },
      {},
      {},
      home,
    );
    const { config } = loadFileConfig({}, home);
    expect(config.active).toBe("office");
    expect(config.profiles?.office?.sshHost).toBe("bastion.example.com");
    // Flat mirror — every existing consumer reads these.
    expect(config.redisUrl).toBe("redis://:s3cret@redis.internal:6380/2");
    expect(config.sshUser).toBe("deploy");
    const conn = resolveConnection(config, {});
    expect(conn.workspace).toBe("api");
    expect(conn.namespace).toBe("prod");
  });

  it("add without activate keeps the current flat connection", () => {
    const home = tmpHome();
    saveFileConfig({ redisUrl: "redis://127.0.0.1:6379", workspace: "main" }, {}, home);
    saveProfile(
      "personal",
      { redisUrl: "redis://other:6379", namespace: "dev" },
      { activate: false },
      {},
      home,
    );
    const { config } = loadFileConfig({}, home);
    expect(config.active).toBeUndefined();
    expect(config.redisUrl).toBe("redis://127.0.0.1:6379");
    expect(listProfiles(config).map((p) => p.name)).toEqual(["personal"]);
  });

  it("activateProfile switches the flat mirror", () => {
    const home = tmpHome();
    saveProfile("a", { redisUrl: "redis://a:6379", workspace: "wa" }, {}, {}, home);
    saveProfile(
      "b",
      { redisUrl: "redis://b:6379", namespace: "prod", sshHost: "b-host" },
      { activate: false },
      {},
      home,
    );
    const conn = activateProfile("b", {}, home);
    expect(conn.redisUrl).toBe("redis://b:6379");
    expect(conn.sshHost).toBe("b-host");
    const { config } = loadFileConfig({}, home);
    expect(config.active).toBe("b");
    expect(config.redisUrl).toBe("redis://b:6379");
    // Fields absent from b are cleared from the mirror.
    expect(config.workspace).toBeUndefined();
    expect(() => activateProfile("nope", {}, home)).toThrow(/No connection profile/);
  });

  it("deleting the active profile promotes the next one", () => {
    const home = tmpHome();
    saveProfile("b", { redisUrl: "redis://b:6379" }, {}, {}, home);
    saveProfile("a", { redisUrl: "redis://a:6379" }, { activate: false }, {}, home);
    const result = deleteProfile("b", {}, home);
    expect(result.activeNow).toBe("a");
    expect(result.conn?.redisUrl).toBe("redis://a:6379");
    const { config } = loadFileConfig({}, home);
    expect(config.active).toBe("a");
    expect(config.redisUrl).toBe("redis://a:6379");
  });

  it("deleting the last profile keeps the flat connection usable", () => {
    const home = tmpHome();
    saveProfile("only", { redisUrl: "redis://x:6379" }, {}, {}, home);
    const result = deleteProfile("only", {}, home);
    expect(result.activeNow).toBeUndefined();
    const { config } = loadFileConfig({}, home);
    expect(config.active).toBeUndefined();
    expect(config.profiles).toBeUndefined();
    expect(config.redisUrl).toBe("redis://x:6379");
    expect(deleteProfile("missing", {}, home).removed).toBe(false);
  });

  it("saveFileConfig preserves profiles and unknown keys", () => {
    const home = tmpHome();
    saveProfile("office", { redisUrl: "redis://o:6379" }, {}, {}, home);
    const path = saveFileConfig({ redisUrl: "redis://o:6379", workspace: "newws" }, {}, home);
    const raw = JSON.parse(readFileSync(path, "utf8"));
    expect(raw.active).toBe("office");
    expect(raw.profiles.office).toMatchObject({ redisUrl: "redis://o:6379" });
    expect(raw.workspace).toBe("newws");
  });

  it("profile names are validated", () => {
    expect(assertProfileName("office-2.ok")).toBe("office-2.ok");
    expect(() => assertProfileName("bad name")).toThrow();
    expect(() => saveProfile("../etc", { redisUrl: "r" }, {}, {}, tmpHome())).toThrow();
  });

  it("describeConnection masks credentials", () => {
    const line = describeConnection({
      redisUrl: "redis://user:hunter2@redis.internal:6380/0",
      namespace: "prod",
      joinToken: "s3cr3t-value",
      sshHost: "bastion",
      sshUser: "deploy",
      sshPort: "2222",
    });
    expect(line).not.toContain("hunter2");
    expect(line).not.toContain("s3cr3t-value");
    expect(line).toContain("ns:prod");
    expect(line).toContain("ssh:deploy@bastion:2222");
  });
});

describe("parseSshTarget", () => {
  it("parses [user@]host[:port]", () => {
    expect(parseSshTarget("bastion")).toEqual({ sshHost: "bastion" });
    expect(parseSshTarget("deploy@bastion:2222")).toEqual({
      sshUser: "deploy",
      sshHost: "bastion",
      sshPort: "2222",
    });
    expect(parseSshTarget("bastion:2200").sshPort).toBe("2200");
  });
  it("rejects empty and bad ports", () => {
    expect(() => parseSshTarget("  ")).toThrow();
    expect(() => parseSshTarget("@")).toThrow();
    expect(() => parseSshTarget("host:99999")).toThrow(/port/);
  });
});

describe("connectionFromFlags", () => {
  it("builds a profile from flags including a combined --ssh target", () => {
    const { conn, switchProfile, noTest } = connectionFromFlags([
      "--redis",
      "redis://h:6379/0",
      "--namespace",
      "prod",
      "--workspace",
      "api",
      "--token",
      "t",
      "--ssh",
      "deploy@bastion:2222",
      "--ssh-key",
      "~/.ssh/id_ed25519",
      "--switch",
    ]);
    expect(conn).toMatchObject({
      redisUrl: "redis://h:6379/0",
      namespace: "prod",
      workspace: "api",
      joinToken: "t",
      sshHost: "bastion",
      sshPort: "2222",
      sshUser: "deploy",
      sshKey: "~/.ssh/id_ed25519",
    });
    expect(switchProfile).toBe(true);
    expect(noTest).toBe(false);
  });

  it("explicit --ssh-* flags override the combined target", () => {
    const { conn } = connectionFromFlags([
      "--ssh",
      "u1@h1:2200",
      "--ssh-user",
      "u2",
      "--ssh-port",
      "2299",
    ]);
    expect(conn.sshUser).toBe("u2");
    expect(conn.sshPort).toBe("2299");
    expect(conn.sshHost).toBe("h1");
  });
});
