import { afterEach, describe, expect, it, vi } from "vitest";

const ENV_KEYS = [
  "NO_COLOR",
  "COLORTERM",
  "TERM",
  "TERM_PROGRAM",
  "WT_SESSION",
  "LATTICE_ASCII",
] as const;

async function loadTheme() {
  vi.resetModules();
  return await import("../src/tui/theme.js");
}

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("tui theme — terminal capability tiers", () => {
  it("uses the hex palette when COLORTERM advertises truecolor", async () => {
    vi.stubEnv("COLORTERM", "truecolor");
    const { colors } = await loadTheme();
    expect(colors.accent).toBe("#7aa2f7");
    expect(typeof colors.fg === "string" && colors.fg.startsWith("#")).toBe(true);
  });

  it("uses the hex palette inside Windows Terminal even without COLORTERM", async () => {
    clearEnv();
    vi.stubEnv("WT_SESSION", "abc123");
    const { colors } = await loadTheme();
    expect(colors.accent).toBe("#7aa2f7");
  });

  it("uses the hex palette for direct/truecolor TERM values", async () => {
    clearEnv();
    vi.stubEnv("TERM", "xterm-direct");
    const { colors } = await loadTheme();
    expect(colors.accent).toBe("#7aa2f7");
  });

  it("falls back to ANSI-16 named colors without truecolor signals", async () => {
    clearEnv();
    vi.stubEnv("TERM", "xterm-256color");
    const { RGBA } = await import("@opentui/core");
    const { colors } = await loadTheme();
    expect(colors.accent).toBe("brightCyan");
    expect(colors.bad).toBe("brightRed");
    // Default fg/bg expressed via the default-intent RGBA, not a string.
    expect(colors.fg).toBeInstanceOf(RGBA);
    expect((colors.fg as InstanceType<typeof RGBA>).intent).toBe("default");
    // No hex anywhere — hex collapses unpredictably on 16-color terminals.
    for (const v of Object.values(colors)) {
      expect(typeof v === "string" && v.startsWith("#")).toBe(false);
    }
  });

  it("honors NO_COLOR with a fully monochrome palette", async () => {
    clearEnv();
    vi.stubEnv("NO_COLOR", "1");
    vi.stubEnv("COLORTERM", "truecolor");
    const { RGBA } = await import("@opentui/core");
    const { colors } = await loadTheme();
    // Everything default-intent except the selection shade, which must stay
    // visible or the room list becomes unusable.
    for (const [k, v] of Object.entries(colors)) {
      if (k === "select") {
        expect(v).toBe("brightBlack");
      } else {
        expect(v).toBeInstanceOf(RGBA);
        expect((v as InstanceType<typeof RGBA>).intent).toBe("default");
      }
    }
  });

  it("uses unicode glyphs on modern terminals", async () => {
    clearEnv();
    vi.stubEnv("COLORTERM", "truecolor");
    vi.stubEnv("TERM", "xterm-256color");
    const { glyphs } = await loadTheme();
    expect(glyphs.pointer).toBe("▸");
    expect(glyphs.spinner[0]).toBe("⠋");
  });

  it("LATTICE_ASCII=1 forces ASCII glyphs regardless of terminal", async () => {
    clearEnv();
    vi.stubEnv("COLORTERM", "truecolor");
    vi.stubEnv("LATTICE_ASCII", "1");
    const { glyphs } = await loadTheme();
    expect(glyphs.pointer).toBe(">");
    expect(glyphs.dotOn).toBe("*");
    expect(glyphs.enter).toBe("ret");
    for (const v of Object.values(glyphs)) {
      for (const g of Array.isArray(v) ? v : [v]) {
        expect(/^[ -~]+$/.test(g)).toBe(true);
      }
    }
  });

  it("LATTICE_ASCII=0 keeps unicode glyphs on legacy conhost", async () => {
    clearEnv();
    vi.stubEnv("LATTICE_ASCII", "0");
    const { glyphs } = await loadTheme();
    expect(glyphs.pointer).toBe("▸");
  });
});
