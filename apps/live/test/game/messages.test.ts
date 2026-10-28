import { describe, expect, test } from "vitest";
import { clientMessageSchema, parseClientMessage } from "../../src/worker/messages";

describe("clientMessageSchema", () => {
  test("accepts valid join / answer / advance", () => {
    expect(clientMessageSchema.safeParse({ type: "join", nickname: "taro" }).success).toBe(true);
    expect(clientMessageSchema.safeParse({ type: "answer", questionIndex: 0, choice: 2 }).success).toBe(true);
    expect(clientMessageSchema.safeParse({ type: "advance", from: "q0:question" }).success).toBe(true);
  });

  test("rejects malformed, wrong-typed and unknown messages", () => {
    for (const bad of [
      null,
      "join",
      42,
      [],
      {},
      { type: "unknown" },
      { type: "join" },
      { type: "join", nickname: 1 },
      { type: "answer", questionIndex: "0", choice: 1 },
      { type: "answer", questionIndex: 0 },
      { type: "advance", from: 3 },
    ]) {
      expect(clientMessageSchema.safeParse(bad).success).toBe(false);
    }
  });

  test("tolerates extra fields and strips them", () => {
    const r = clientMessageSchema.safeParse({ type: "join", nickname: "a", extra: 1 });
    expect(r.success).toBe(true);
    expect(r.data).toEqual({ type: "join", nickname: "a" });
  });

  test("leaves range checks to the game layer", () => {
    expect(clientMessageSchema.safeParse({ type: "answer", questionIndex: -5, choice: 99 }).success).toBe(true);
    expect(clientMessageSchema.safeParse({ type: "answer", questionIndex: 0, choice: 1.5 }).success).toBe(true);
    expect(clientMessageSchema.safeParse({ type: "join", nickname: "" }).success).toBe(true);
  });
});

describe("parseClientMessage", () => {
  test("returns null for malformed JSON", () => {
    expect(parseClientMessage("{nope")).toBeNull();
  });
  test("returns the message for valid JSON", () => {
    expect(parseClientMessage('{"type":"advance","from":"x"}')).toEqual({ type: "advance", from: "x" });
  });
});
