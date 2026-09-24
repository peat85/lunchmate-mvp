import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, createSessionToken, readSessionToken } from "../src/auth.js";

describe("passwords", () => {
  it("hashes with a salt and verifies", () => {
    const h = hashPassword("correct-horse");
    expect(h).not.toContain("correct-horse");
    expect(h).not.toBe(hashPassword("correct-horse"));
    expect(verifyPassword("correct-horse", h)).toBe(true);
    expect(verifyPassword("wrong", h)).toBe(false);
    expect(verifyPassword("x", "garbage")).toBe(false);
  });
});

describe("session tokens", () => {
  it("round-trips and rejects tampering, wrong secrets and expiry", () => {
    const t = createSessionToken(7, "secret", 1000);
    expect(readSessionToken(t, "secret", 2000)).toBe(7);
    expect(readSessionToken(t.replace(/^7/, "8"), "secret", 2000)).toBeNull();
    expect(readSessionToken(t, "other", 2000)).toBeNull();
    expect(readSessionToken(t, "secret", 1000 + 31 * 86_400_000)).toBeNull();
    expect(readSessionToken(undefined, "secret")).toBeNull();
  });
});
