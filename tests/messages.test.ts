import { describe, expect, it } from "vitest";
import { clampPullLimit, parseKind, parseStreamMessage, truncateBody } from "../src/core/messages.js";
import { compareStreamIds, exclusiveStart, isAfterCursor } from "../src/core/stream.js";

describe("cursor and stream ids", () => {
  it("compares Redis-style ids by time then sequence", () => {
    expect(compareStreamIds("100-1", "100-2")).toBeLessThan(0);
    expect(compareStreamIds("200-0", "100-9")).toBeGreaterThan(0);
    expect(compareStreamIds("5-10", "5-2")).toBeGreaterThan(0);
  });

  it("treats empty / 0-0 as the start of the stream", () => {
    expect(isAfterCursor("1-0", undefined)).toBe(true);
    expect(isAfterCursor("1-0", "0-0")).toBe(true);
    expect(isAfterCursor("1-0", "0")).toBe(true);
    expect(isAfterCursor("1-0", "1-0")).toBe(false);
    expect(isAfterCursor("1-1", "1-0")).toBe(true);
  });

  it("builds exclusive XRANGE starts", () => {
    expect(exclusiveStart(undefined)).toBe("-");
    expect(exclusiveStart("0-0")).toBe("-");
    expect(exclusiveStart("171-3")).toBe("(171-3");
  });
});

describe("body truncate and kinds", () => {
  it("truncates long bodies and flags them", () => {
    const long = "x".repeat(2500);
    const cut = truncateBody(long, 2000);
    expect(cut.body).toHaveLength(2000);
    expect(cut.truncated).toBe(true);
    expect(truncateBody("short").truncated).toBe(false);
  });

  it("clamps pull limits", () => {
    expect(clampPullLimit(undefined)).toBe(50);
    expect(clampPullLimit(0)).toBe(1);
    expect(clampPullLimit(999)).toBe(200);
    expect(clampPullLimit(12.7)).toBe(12);
  });

  it("defaults unknown kinds to chat", () => {
    expect(parseKind("task")).toBe("task");
    expect(parseKind("nope")).toBe("chat");
    expect(parseKind(undefined)).toBe("chat");
  });

  it("parses stream entries and omits empty optional fields", () => {
    const msg = parseStreamMessage({
      id: "1-0",
      fields: {
        from: "a",
        role: "fe",
        harness: "cursor",
        kind: "status",
        body: "ok",
        ts: "t",
        to: "",
      },
    });
    expect(msg.to).toBeUndefined();
    expect(msg.kind).toBe("status");
    expect(msg.truncated).toBeUndefined();
  });
});
