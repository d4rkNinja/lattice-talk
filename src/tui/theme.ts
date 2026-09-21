import { RGBA, type ColorInput } from "@opentui/core";

/**
 * Shared palette for the Lattice TUI.
 *
 * Three tiers, picked at load:
 *  - NO_COLOR set          → monochrome (terminal defaults only)
 *  - no truecolor support  → ANSI-16 named colors — every terminal renders
 *    these correctly, including legacy conhost.exe, Terminal.app, and linux
 *    consoles where 24-bit hex values collapse into unreadable approximations.
 *    OpenTUI quantizes the named-color hex approximations back to the
 *    terminal's ANSI-16 palette, so contrast stays intact.
 *  - truecolor             → the full hex palette
 *
 * "Default" fg/bg is expressed via RGBA.defaultForeground()/defaultBackground()
 * (intent: default) — the string "default" is NOT a valid ColorInput.
 */

function supportsTruecolor(env: NodeJS.ProcessEnv = process.env): boolean {
  const colorterm = (env.COLORTERM ?? "").toLowerCase();
  if (colorterm.includes("truecolor") || colorterm.includes("24bit")) return true;
  const term = (env.TERM ?? "").toLowerCase();
  if (term.includes("direct") || term.includes("truecolor")) return true;
  // Windows Terminal doesn't always set COLORTERM.
  if (env.WT_SESSION) return true;
  return false;
}

const rich = {
  bg: "#0d0f16",
  panel: "#141824",
  panelAlt: "#1c2233",
  select: "#3b4261",
  border: "#3b4261",
  borderActive: "#7aa2f7",
  fg: "#c8d3f5",
  muted: "#8a94b8",
  accent: "#7aa2f7",
  accentAlt: "#89ddff",
  good: "#9ece6a",
  warn: "#e0af68",
  bad: "#f7768e",
  dim: "#5a6488",
} as const;

const ansi16 = {
  bg: RGBA.defaultBackground(),
  panel: RGBA.defaultBackground(),
  panelAlt: RGBA.defaultBackground(),
  select: "brightBlack",
  border: "brightBlack",
  borderActive: "brightCyan",
  fg: RGBA.defaultForeground(),
  muted: "brightBlack",
  accent: "brightCyan",
  accentAlt: "cyan",
  good: "brightGreen",
  warn: "brightYellow",
  bad: "brightRed",
  dim: "brightBlack",
} as const;

const mono = {
  bg: RGBA.defaultBackground(),
  panel: RGBA.defaultBackground(),
  panelAlt: RGBA.defaultBackground(),
  select: "brightBlack",
  border: RGBA.defaultForeground(),
  borderActive: RGBA.defaultForeground(),
  fg: RGBA.defaultForeground(),
  muted: RGBA.defaultForeground(),
  accent: RGBA.defaultForeground(),
  accentAlt: RGBA.defaultForeground(),
  good: RGBA.defaultForeground(),
  warn: RGBA.defaultForeground(),
  bad: RGBA.defaultForeground(),
  dim: RGBA.defaultForeground(),
} as const;

export type Palette = Record<keyof typeof rich, ColorInput>;

export type ColorTier = "rich" | "ansi16" | "mono";

export const colorTier: ColorTier = process.env.NO_COLOR
  ? "mono"
  : supportsTruecolor()
    ? "rich"
    : "ansi16";

export const colors: Palette =
  colorTier === "mono" ? { ...mono } : colorTier === "rich" ? { ...rich } : { ...ansi16 };

/**
 * Glyph set. Legacy Windows conhost (cmd/PowerShell without Windows
 * Terminal) can't render braille, arrows, or block glyphs — detect that
 * shell and swap in ASCII. LATTICE_ASCII=1 forces it anywhere (SSH, tmux).
 */
function legacyConsole(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.LATTICE_ASCII === "1" || env.LATTICE_ASCII === "true") return true;
  if (env.LATTICE_ASCII === "0" || env.LATTICE_ASCII === "false") return false;
  if (process.platform !== "win32") return false;
  // Windows Terminal, VSCode terminal, WezTerm etc. all advertise themselves.
  return !env.WT_SESSION && !env.TERM_PROGRAM && !env.TERM;
}

export const asciiGlyphs = legacyConsole();

export const glyphs = asciiGlyphs
  ? {
      spinner: ["|", "/", "-", "\\"],
      pointer: ">",
      dotOn: "*",
      dotOff: "o",
      enter: "ret",
      updown: "u/d",
      leftright: "l/r",
      arrow: "->",
      bullet: "-",
      sep: "-",
      dash: "-",
      dots: "...",
      ok: "ok",
      bad: "x",
    }
  : {
      spinner: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
      pointer: "▸",
      dotOn: "●",
      dotOff: "○",
      enter: "⏎",
      updown: "↑↓",
      leftright: "←→",
      arrow: "→",
      bullet: "·",
      sep: "·",
      dash: "—",
      dots: "…",
      ok: "✓",
      bad: "✗",
    };

/**
 * Animations off when asked (LATTICE_NO_ANIM) or on legacy consoles: if the
 * renderer's frame engine can't tick reliably there, opacity-animated
 * elements would be stuck near-invisible — a ghost-dark UI.
 */
export const noAnim =
  ["1", "true", "yes", "on"].includes((process.env.LATTICE_NO_ANIM ?? "").toLowerCase()) ||
  asciiGlyphs;

export const kindColor: Record<string, ColorInput> = {
  chat: colors.fg,
  task: colors.warn,
  status: colors.accentAlt,
  system: colors.muted,
};
