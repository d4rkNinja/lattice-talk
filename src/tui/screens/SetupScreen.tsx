import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import {
  loadFileConfig,
  saveFileConfig,
  type ResolvedConnection,
} from "../../cli/config-file.js";
import { parseSshTarget, saveProfile } from "../../cli/connections.js";
import { pingBus } from "../bus.js";
import { FadeIn, Footer, Header, Key, Logo, Spinner } from "../components.js";
import { colors, glyphs } from "../theme.js";

interface Field {
  key: string;
  label: string;
  placeholder: string;
  hint: string;
}

const FIELDS: Field[] = [
  {
    key: "redisUrl",
    label: "Redis URL",
    placeholder: "redis://127.0.0.1:6379/0",
    hint: `redis:// or rediss:// (TLS) ${glyphs.dash} every agent harness uses this bus`,
  },
  {
    key: "namespace",
    label: "Namespace",
    placeholder: "dev",
    hint: "isolates Lattice environments (letters, digits, . _ -)",
  },
  {
    key: "workspace",
    label: "Workspace",
    placeholder: "my-project",
    hint: "the session agents join; rooms live inside it",
  },
  {
    key: "joinToken",
    label: "Join token",
    placeholder: "(optional)",
    hint: "when set, agents need the same LATTICE_JOIN_TOKEN to join",
  },
];

const SSH_FIELDS: Field[] = [
  {
    key: "sshTarget",
    label: "SSH target",
    placeholder: "deploy@bastion.example.com:2222",
    hint: `[user@]host[:port] ${glyphs.dash} auth via ssh agent, key file, or ~/.ssh/config`,
  },
  {
    key: "sshKey",
    label: "SSH key",
    placeholder: "~/.ssh/id_ed25519  (optional)",
    hint: "identity file passed to ssh -i",
  },
];

type Row =
  | { kind: "field"; field: Field }
  | { kind: "toggle" }
  | { kind: "save" };

function sshTargetFrom(conn: ResolvedConnection): string {
  if (!conn.sshHost) return "";
  const user = conn.sshUser ? `${conn.sshUser}@` : "";
  const port = conn.sshPort && conn.sshPort !== "22" ? `:${conn.sshPort}` : "";
  return `${user}${conn.sshHost}${port}`;
}

export function SetupScreen({
  initial,
  notice,
  profileName,
  onSaved,
}: {
  initial: ResolvedConnection;
  notice?: string;
  /** When set, saving writes this named profile and activates it. */
  profileName?: string;
  onSaved(conn: ResolvedConnection): void;
}) {
  const [values, setValues] = useState<Record<string, string>>({
    redisUrl: initial.redisUrl ?? "",
    namespace: initial.namespace ?? "",
    workspace: initial.workspace ?? "",
    joinToken: initial.joinToken ?? "",
    sshTarget: sshTargetFrom(initial),
    sshKey: initial.sshKey ?? "",
  });
  const [sshOn, setSshOn] = useState(Boolean(initial.sshHost));
  const [focus, setFocus] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const rows: Row[] = [
    ...FIELDS.map((field): Row => ({ kind: "field", field })),
    { kind: "toggle" },
    ...(sshOn ? SSH_FIELDS.map((field): Row => ({ kind: "field", field })) : []),
    { kind: "save" },
  ];
  const saveIndex = rows.length - 1;

  const buildConn = (): ResolvedConnection => {
    const conn: ResolvedConnection = {
      redisUrl: values.redisUrl?.trim() || "redis://127.0.0.1:6379/0",
      namespace: values.namespace?.trim() || "dev",
      workspace: values.workspace?.trim() || "main",
      joinToken: values.joinToken?.trim() || undefined,
    };
    if (sshOn) {
      const target = parseSshTarget(values.sshTarget ?? "");
      conn.sshHost = target.sshHost;
      if (target.sshPort) conn.sshPort = target.sshPort;
      if (target.sshUser) conn.sshUser = target.sshUser;
      if (values.sshKey?.trim()) conn.sshKey = values.sshKey.trim();
      if (initial.sshLocalPort) conn.sshLocalPort = initial.sshLocalPort;
    }
    return conn;
  };

  const submit = async () => {
    if (busy) return;
    let conn: ResolvedConnection;
    try {
      conn = buildConn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await pingBus(conn);
      if (profileName) {
        saveProfile(profileName, conn, { activate: true });
      } else {
        // Editing the active profile's mirror keeps the two in sync.
        const { config } = loadFileConfig();
        if (config.active && config.profiles?.[config.active]) {
          saveProfile(config.active, conn, { activate: true });
        } else {
          saveFileConfig(conn);
        }
      }
      onSaved(conn);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  useKeyboard((key) => {
    if (busy) return;
    if (key.name === "tab" || (key.name === "down" && !key.shift)) {
      setFocus((f) => (f + 1) % rows.length);
    } else if ((key.name === "tab" && key.shift) || (key.name === "up" && !key.shift)) {
      setFocus((f) => (f - 1 + rows.length) % rows.length);
    } else if (key.name === "return") {
      const row = rows[focus];
      if (row?.kind === "toggle") setSshOn((v) => !v);
      else if (row?.kind === "save") void submit();
    }
  });

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={colors.bg}>
      <Header left={profileName ? `new connection ${glyphs.dash} ${profileName}` : "guided setup"} />
      <box flexGrow={1} justifyContent="center" alignItems="center" flexDirection="column">
        <FadeIn duration={280} marginBottom={1}>
          <Logo />
        </FadeIn>
        <FadeIn duration={240} slide={1}>
        <box
          border
          borderStyle="rounded"
          borderColor={colors.borderActive}
          title={profileName ? `Profile ${glyphs.dash} ${profileName}` : "Connect to your bus"}
          titleColor={colors.accent}
          padding={2}
          width={72}
          backgroundColor={colors.panel}
          flexDirection="column"
          gap={1}
        >
          {notice ? <text fg={colors.warn}>{notice}</text> : null}
          <text fg={colors.muted}>
            Agents reach each other through Redis. These details are stored in
            ~/.lattice/config.json {glyphs.dash} never sent anywhere else.
          </text>
          {rows.map((row, i) => {
            if (row.kind === "toggle") {
              return (
                <box key="ssh-toggle" flexDirection="row" gap={1}>
                  <text width={12} fg={focus === i ? colors.accent : colors.fg}>
                    Tunnel
                  </text>
                  <text fg={focus === i ? colors.accent : colors.muted}>
                    {sshOn ? "[x]" : "[ ]"} connect through an SSH bastion
                  </text>
                </box>
              );
            }
            if (row.kind === "save") {
              return (
                <box
                  key="save"
                  border
                  borderStyle="rounded"
                  borderColor={focus === i ? colors.accent : colors.border}
                  paddingX={2}
                  width={20}
                  onMouseDown={() => void submit()}
                >
                  {busy ? (
                    <Spinner label="testing" />
                  ) : (
                    <text fg={focus === i ? colors.accent : colors.fg}>{glyphs.arrow} test & save</text>
                  )}
                </box>
              );
            }
            const f = row.field;
            return (
              <box key={f.key} flexDirection="column">
                <box flexDirection="row" gap={1}>
                  <text width={12} fg={focus === i ? colors.accent : colors.fg}>
                    {f.label}
                  </text>
                  <input
                    value={values[f.key] ?? ""}
                    onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
                    placeholder={f.placeholder}
                    placeholderColor={colors.dim}
                    textColor={colors.fg}
                    backgroundColor={colors.panelAlt}
                    focusedBackgroundColor={colors.panelAlt}
                    cursorColor={colors.accent}
                    width={52}
                    focused={focus === i}
                    onSubmit={() => setFocus(Math.min(i + 1, saveIndex))}
                  />
                </box>
                <box flexDirection="row">
                  <text width={12}> </text>
                  <text fg={colors.dim}>{f.hint}</text>
                </box>
              </box>
            );
          })}
          {error ? <text fg={colors.bad}>{glyphs.bad} {error}</text> : null}
        </box>
        </FadeIn>
      </box>
      <Footer>
        <Key k={`tab/${glyphs.updown}`} label="move" />
        <Key k={glyphs.enter} label="next / save" />
      </Footer>
    </box>
  );
}
