import { describe, expect, test } from "vitest";
import { hostTokenFor, isUsableSecret, MIN_ADMIN_SECRET_LENGTH, verifyBearer } from "../../src/worker/auth";

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
