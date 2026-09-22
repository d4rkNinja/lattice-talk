import { useKeyboard, useRenderer, useTimeline } from "@opentui/react";
import type { BoxRenderable } from "@opentui/core";
import { useEffect, useRef, useState } from "react";
import { colors, glyphs, noAnim } from "./theme.js";
import { VERSION } from "./version.js";

/** Spinner for async states — braille on capable terminals, ASCII on legacy. */
export function Spinner({ label }: { label?: string }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setFrame((f) => (f + 1) % glyphs.spinner.length), 80);
    return () => clearInterval(t);
  }, []);
  return (
    <text>
      <span fg={colors.accent}>{glyphs.spinner[frame]}</span>
      {label ? <span fg={colors.muted}> {label}</span> : null}
    </text>
  );
}

/**
 * Slides in once on mount. Opacity is deliberately never touched: a
 * mid-animation opacity value gets baked into the renderer's push/pop
 * commands, and on terminals where the frame engine stalls (or a frame is
 * aborted mid-list) the dimming never goes away — the ghost-dark UI bug.
 * A frozen slide only leaves a one-cell offset, which is harmless.
 */
export function FadeIn({
  children,
  slide = 0,
  duration = 160,
  ...rest
}: {
  children?: React.ReactNode;
  slide?: number;
  duration?: number;
  [key: string]: unknown;
}) {
  const ref = useRef<BoxRenderable | null>(null);
  const timeline = useTimeline();
  const played = useRef(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || played.current || noAnim || !slide) return;
    played.current = true;
    node.translateY = slide;
    timeline.add(node, { translateY: 0, duration, ease: "outQuad" });
    // Failsafe: if the frame engine never ticks, clear the offset so the
    // element can't be left nudged out of place.
    const t = setTimeout(() => {
      node.translateY = 0;
    }, duration + 400);
    return () => clearTimeout(t);
  }, [timeline, slide, duration]);
  return (
    <box ref={ref} {...rest}>
      {children}
    </box>
  );
}

/** ASCII-art wordmark for splash/setup screens. */
export function Logo({ font = "tiny" }: { font?: "tiny" | "block" | "slick" }) {
  return (
    <ascii-font text="lattice" font={font} color={colors.accent} selectable={false} />
  );
}

/** Pulsing accent dot — a subtle "live" indicator. Interval-driven like
 *  Spinner (no renderable opacity, which can stick on stalled frame engines). */
export function LiveDot({ label = "live" }: { label?: string }) {
  const [on, setOn] = useState(true);
  useEffect(() => {
    if (noAnim) return;
    const t = setInterval(() => setOn((v) => !v), 800);
    return () => clearInterval(t);
  }, []);
  return (
    <box flexDirection="row">
      <text fg={on ? colors.good : colors.dim}>{glyphs.dotOn}</text>
      {label ? <text fg={colors.muted}> {label}</text> : null}
    </box>
  );
}

export function Key({ k, label }: { k: string; label: string }) {
  return (
    <text>
      <span fg={colors.accent}> {k} </span>
      <span fg={colors.muted}>{label}</span>
    </text>
  );
}

export function Header({ left, right }: { left: string; right?: React.ReactNode }) {
  return (
    <box
      flexDirection="row"
      justifyContent="space-between"
      paddingX={2}
      height={1}
      backgroundColor={colors.panelAlt}
    >
      <text>
        <span fg={colors.accent}>
          <strong>lattice-talk</strong>
        </span>
        <span fg={colors.muted}>  {left}</span>
      </text>
      {typeof right === "string" ? (
        <text fg={colors.muted}>{right}</text>
      ) : (
        (right ?? <text fg={colors.muted}>v{VERSION}</text>)
      )}
    </box>
  );
}

export function Footer({ children }: { children: React.ReactNode }) {
  return (
    <box
      flexDirection="row"
      gap={2}
      paddingX={1}
      height={1}
      backgroundColor={colors.panelAlt}
    >
      {children}
    </box>
  );
}

/** Centered overlay modal. Parent decides visibility. */
export function Modal({
  title,
  width = 64,
  children,
}: {
  title: string;
  width?: number;
  children: React.ReactNode;
}) {
  const panelRef = useRef<BoxRenderable | null>(null);
  const timeline = useTimeline();
  useEffect(() => {
    const node = panelRef.current;
    if (!node || noAnim) return;
    node.translateY = 1;
    timeline.add(node, { translateY: 0, duration: 130, ease: "outQuad" });
    const t = setTimeout(() => {
      node.translateY = 0;
    }, 530);
    return () => clearTimeout(t);
  }, [timeline]);
  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width="100%"
      height="100%"
      justifyContent="center"
      alignItems="center"
      backgroundColor="#000000a0"
    >
      <box
        ref={panelRef}
        border
        borderStyle="rounded"
        borderColor={colors.borderActive}
        title={title}
        titleColor={colors.accent}
        padding={2}
        width={width}
        backgroundColor={colors.panel}
        flexDirection="column"
        gap={1}
      >
        {children}
      </box>
    </box>
  );
}

export function ConfirmModal({
  title,
  body,
  confirmLabel = "confirm",
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel?: string;
  onConfirm(): void;
  onCancel(): void;
}) {
  useKeyboard((key) => {
    if (key.name === "y" || key.name === "return") onConfirm();
    if (key.name === "n" || key.name === "escape") onCancel();
  });
  return (
    <Modal title={title} width={Math.max(50, Math.min(70, body.length + 12))}>
      <text fg={colors.fg}>{body}</text>
      <box flexDirection="row" gap={2}>
        <Key k={`y/${glyphs.enter}`} label={confirmLabel} />
        <Key k="n/esc" label="cancel" />
      </box>
    </Modal>
  );
}

export function InputModal({
  title,
  placeholder,
  initial = "",
  hint,
  onSubmit,
  onCancel,
}: {
  title: string;
  placeholder: string;
  initial?: string;
  hint?: string;
  onSubmit(value: string): void;
  onCancel(): void;
}) {
  const [value, setValue] = useState(initial);
  useKeyboard((key) => {
    if (key.name === "escape") onCancel();
  });
  return (
    <Modal title={title}>
      <input
        value={value}
        onChange={setValue}
        placeholder={placeholder}
        placeholderColor={colors.dim}
        textColor={colors.fg}
        backgroundColor={colors.panelAlt}
        focusedBackgroundColor={colors.panelAlt}
        cursorColor={colors.accent}
        focused
        onSubmit={(v) => onSubmit(typeof v === "string" ? v : value)}
      />
      {hint ? <text fg={colors.muted}>{hint}</text> : null}
      <box flexDirection="row" gap={2}>
        <Key k={glyphs.enter} label="confirm" />
        <Key k="esc" label="cancel" />
      </box>
    </Modal>
  );
}

/** Pick an existing workspace session, or choose "+ New workspace". */
export function WorkspaceModal({
  sessions,
  current,
  onPick,
  onCancel,
}: {
  sessions: string[];
  current: string;
  onPick(value: string): void;
  onCancel(): void;
}) {
  useKeyboard((key) => {
    if (key.name === "escape") onCancel();
  });
  return (
    <Modal title="Switch workspace" width={50}>
      <select
        options={[
          ...sessions.map((s) => ({
            name: s === current ? `${s} (current)` : s,
            description: "existing session on this bus",
            value: s,
          })),
          {
            name: "+ New workspace",
            description: "create a fresh session",
            value: "__new__",
          },
        ]}
        focused
        height={Math.min(10, sessions.length + 1)}
        selectedBackgroundColor={colors.select}
        selectedTextColor={colors.accent}
        onSelect={(_i, opt) => {
          if (opt) onPick(String(opt.value));
        }}
      />
      <box flexDirection="row" gap={2}>
        <Key k={glyphs.enter} label="choose" />
        <Key k="esc" label="cancel" />
      </box>
    </Modal>
  );
}

/** Copyable prompt shown after creating a room / via the `p` key. */
export function PromptModal({
  text,
  onClose,
}: {
  text: string;
  onClose(): void;
}) {
  const renderer = useRenderer();
  const [copied, setCopied] = useState(false);
  useKeyboard((key) => {
    if (key.name === "escape") onClose();
    if (key.name === "c") {
      const ok = renderer.copyToClipboardOSC52(text);
      if (ok) setCopied(true);
    }
  });
  return (
    <Modal title="Agent join prompt" width={78}>
      <text fg={colors.muted}>
        Paste this into an agent (Claude Code, Codex{glyphs.dots}) to connect it:
      </text>
      <box border borderStyle="single" borderColor={colors.border} padding={1}>
        <text selectable fg={colors.fg}>
          {text}
        </text>
      </box>
      <box flexDirection="row" gap={2}>
        <Key k="c" label={copied ? `copied ${glyphs.ok}` : "copy to clipboard"} />
        <Key k="esc" label="close" />
      </box>
    </Modal>
  );
}
