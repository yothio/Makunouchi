import { describe, expect, test } from "vitest";
import { hostTokenFor, isUsableSecret, isValidSessionId, MIN_ADMIN_SECRET_LENGTH, screenTokenFor, verifyBearer } from "../../src/worker/auth";

const good = "x".repeat(MIN_ADMIN_SECRET_LENGTH);
const short = "x".repeat(MIN_ADMIN_SECRET_LENGTH - 1);
const bearer = (value: string) => new Request("https://x/", { headers: { Authorization: `Bearer ${value}` } });

describe("isUsableSecret", () => {
  test.each([undefined, null, 123, "", short])("rejects %s", (v) => {
    expect(isUsableSecret(v)).toBe(false);
  });
  test("accepts a secret of the minimum length", () => {
    expect(isUsableSecret(good)).toBe(true);
  });
});

describe("verifyBearer", () => {
  test("accepts the matching usable secret", () => {
    expect(verifyBearer(bearer(good), good)).toBe(true);
  });
  test("rejects an unusable secret even when the header matches", () => {
    expect(verifyBearer(bearer(short), short)).toBe(false);
    expect(verifyBearer(bearer(""), "")).toBe(false);
    expect(verifyBearer(bearer("undefined"), undefined as unknown as string)).toBe(false);
  });
});

describe("hostTokenFor", () => {
  test("throws for an unusable secret", () => {
    expect(() => hostTokenFor(short, "s1")).toThrow(/ADMIN_API_SECRET/);
    expect(() => hostTokenFor("", "s1")).toThrow(/ADMIN_API_SECRET/);
  });
  test("derives a hex token for a usable secret", async () => {
    expect(await hostTokenFor(good, "s1")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("screenTokenFor", () => {
  test("throws for an unusable secret", () => {
    expect(() => screenTokenFor(short, "s1")).toThrow(/ADMIN_API_SECRET/);
    expect(() => screenTokenFor("", "s1")).toThrow(/ADMIN_API_SECRET/);
  });
  test("is a 64-char hex, deterministic for the same input", async () => {
    const a = await screenTokenFor(good, "s1");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await screenTokenFor(good, "s1")).toBe(a);
  });
  test("differs from the host token of the same session", async () => {
    expect(await screenTokenFor(good, "s1")).not.toBe(await hostTokenFor(good, "s1"));
  });
  test("differs per session", async () => {
    expect(await screenTokenFor(good, "s1")).not.toBe(await screenTokenFor(good, "s2"));
  });
});

describe("isValidSessionId", () => {
  test.each(["3f2b8c1e-5d4a-4b6f-9a7e-1c2d3e4f5a6b", "session-1-2-abc", "a", "A_b-9", "x".repeat(100)])("accepts %s", (id) => {
    expect(isValidSessionId(id)).toBe(true);
  });
  test.each(["screen:abc", "", "x".repeat(101), "a/b", "a b", "a?b", "日本語"])("rejects %s", (id) => {
    expect(isValidSessionId(id)).toBe(false);
  });
});
