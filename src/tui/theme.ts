/** Shared palette for the Lattice TUI. */
export const colors = {
  bg: "#0b0d12",
  panel: "#12151d",
  panelAlt: "#171b26",
  border: "#2a3040",
  borderActive: "#7aa2f7",
  fg: "#c8d3f5",
  muted: "#6b7394",
  accent: "#7aa2f7",
  accentAlt: "#89ddff",
  good: "#9ece6a",
  warn: "#e0af68",
  bad: "#f7768e",
  dim: "#414868",
} as const;

export const kindColor: Record<string, string> = {
  chat: colors.fg,
  task: colors.warn,
  status: colors.accentAlt,
  system: colors.muted,
};
