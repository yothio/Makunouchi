import { describe, expect, it } from "vitest";
import { matchRoute } from "./route";

describe("matchRoute", () => {
  it("3 つの画面の URL を route と id に振り分ける", () => {
    expect(matchRoute("/s/abc")).toEqual({ route: "guest", id: "abc" });
    expect(matchRoute("/host/abc")).toEqual({ route: "host", id: "abc" });
    expect(matchRoute("/screen/abc")).toEqual({ route: "screen", id: "abc" });
  });

  it("末尾スラッシュや重複スラッシュは無視する", () => {
    expect(matchRoute("/s/abc/")).toEqual({ route: "guest", id: "abc" });
    expect(matchRoute("//host//abc//")).toEqual({ route: "host", id: "abc" });
  });

  it("余分なセグメントがあれば一致しない", () => {
    expect(matchRoute("/s/abc/extra")).toBeNull();
    expect(matchRoute("/host/abc/extra/more")).toBeNull();
  });

  it("id が空なら一致しない", () => {
    expect(matchRoute("/s")).toBeNull();
    expect(matchRoute("/s/")).toBeNull();
    expect(matchRoute("/screen//")).toBeNull();
  });

  it("エンコードされた id はデコードせずそのまま返す", () => {
    expect(matchRoute("/s/a%20b")).toEqual({ route: "guest", id: "a%20b" });
    expect(matchRoute("/host/%E3%81%82")).toEqual({ route: "host", id: "%E3%81%82" });
  });

  it("未知のパスやルートは一致しない", () => {
    expect(matchRoute("/")).toBeNull();
    expect(matchRoute("")).toBeNull();
    expect(matchRoute("/x/abc")).toBeNull();
    expect(matchRoute("/S/abc")).toBeNull();
    expect(matchRoute("/constructor/abc")).toBeNull();
    expect(matchRoute("/__proto__/abc")).toBeNull();
  });
});
