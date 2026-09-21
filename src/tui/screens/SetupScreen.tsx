import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import { saveFileConfig, type ResolvedConnection } from "../../cli/config-file.js";
import { pingBus } from "../bus.js";
import { Footer, Header, Key, Spinner } from "../components.js";
import { colors } from "../theme.js";

interface Field {
  key: keyof ResolvedConnection;
  label: string;
  placeholder: string;
  hint: string;
}

const FIELDS: Field[] = [
  {
    key: "redisUrl",
    label: "Redis URL",
    placeholder: "redis://127.0.0.1:6379/0",
    hint: "redis:// or rediss:// (TLS) — every agent harness uses this bus",
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

const BUTTON_INDEX = FIELDS.length;

export function SetupScreen({
  initial,
  notice,
  onSaved,
}: {
  initial: ResolvedConnection;
  notice?: string;
  onSaved(conn: ResolvedConnection): void;
}) {
  const [values, setValues] = useState<Record<string, string>>({
    redisUrl: initial.redisUrl ?? "",
    namespace: initial.namespace ?? "",
    workspace: initial.workspace ?? "",
    joinToken: initial.joinToken ?? "",
  });
  const [focus, setFocus] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const conn: ResolvedConnection = {
    redisUrl: values.redisUrl?.trim() || "redis://127.0.0.1:6379/0",
    namespace: values.namespace?.trim() || "dev",
    workspace: values.workspace?.trim() || "main",
    joinToken: values.joinToken?.trim() || undefined,
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await pingBus(conn);
      saveFileConfig(conn);
      onSaved(conn);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  useKeyboard((key) => {
    if (busy) return;
    if (key.name === "tab" || (key.name === "down" && !key.shift)) {
      setFocus((f) => (f + 1) % (BUTTON_INDEX + 1));
    } else if ((key.name === "tab" && key.shift) || (key.name === "up" && !key.shift)) {
      setFocus((f) => (f - 1 + BUTTON_INDEX + 1) % (BUTTON_INDEX + 1));
    } else if (key.name === "return" && focus === BUTTON_INDEX) {
      void submit();
    }
  });

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={colors.bg}>
      <Header left="guided setup" right="lattice-talk" />
      <box flexGrow={1} justifyContent="center" alignItems="center">
        <box
          border
          borderStyle="rounded"
          borderColor={colors.borderActive}
          title="Connect to your bus"
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
            ~/.lattice/config.json — never sent anywhere else.
          </text>
          {FIELDS.map((f, i) => (
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
                  onSubmit={() =>
                    i === BUTTON_INDEX - 1 ? setFocus(BUTTON_INDEX) : setFocus(i + 1)
                  }
                />
              </box>
              <box flexDirection="row">
                <text width={12}> </text>
                <text fg={colors.dim}>{f.hint}</text>
              </box>
            </box>
          ))}
          <box
            border
            borderStyle="rounded"
            borderColor={focus === BUTTON_INDEX ? colors.accent : colors.border}
            paddingX={2}
            width={20}
            onMouseDown={() => void submit()}
          >
            {busy ? (
              <Spinner label="testing" />
            ) : (
              <text fg={focus === BUTTON_INDEX ? colors.accent : colors.fg}>→ test & save</text>
            )}
          </box>
          {error ? <text fg={colors.bad}>✗ {error}</text> : null}
        </box>
      </box>
      <Footer>
        <Key k="tab/↑↓" label="move" />
        <Key k="⏎" label="next / save" />
      </Footer>
    </box>
  );
}
