import { describe, expect, test, vi, type Mock } from "vitest";
import { resolveToken, type TokenIo } from "../../src/client/token-store";

const memoryStorage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
};

type TestIo = TokenIo & { replaceUrl: Mock<(url: string) => void> };

const io = (over: Partial<TokenIo> = {}): TestIo => {
  return {
    search: "",
    pathname: "/host/s1",
    hash: "",
    storage: memoryStorage(),
    replaceUrl: vi.fn<(url: string) => void>(),
    ...over,
  } as TestIo;
};

describe("resolveToken", () => {
  test("moves the URL token into storage, strips it from the address and keeps other query and hash", () => {
    const env = io({ search: "?token=abc&x=1", hash: "#h" });
    expect(resolveToken("host", "s1", env)).toBe("abc");
    expect(env.replaceUrl).toHaveBeenCalledWith("/host/s1?x=1#h");
    expect(env.storage?.getItem("makunouchi:s1:hostToken")).toBe("abc");
  });

  test("strips the whole query when token was the only parameter", () => {
    const env = io({ search: "?token=abc" });
    resolveToken("host", "s1", env);
    expect(env.replaceUrl).toHaveBeenCalledWith("/host/s1");
  });

  test("reads the stored token when the URL has none, without touching the address", () => {
    const storage = memoryStorage();
    storage.setItem("makunouchi:s1:hostToken", "saved");
    const env = io({ storage });
    expect(resolveToken("host", "s1", env)).toBe("saved");
    expect(env.replaceUrl).not.toHaveBeenCalled();
  });

  test("host and screen tokens are stored separately", () => {
    const storage = memoryStorage();
    resolveToken("host", "s1", io({ storage, search: "?token=H" }));
    resolveToken("screen", "s1", io({ storage, pathname: "/screen/s1", search: "?token=S" }));
    expect(resolveToken("host", "s1", io({ storage }))).toBe("H");
    expect(resolveToken("screen", "s1", io({ storage }))).toBe("S");
  });

  test("tokens of different sessions do not mix", () => {
    const storage = memoryStorage();
    resolveToken("host", "s1", io({ storage, search: "?token=H1" }));
    expect(resolveToken("host", "s2", io({ storage }))).toBe("");
  });

  test("still returns the URL token when storage is unavailable (null or throwing)", () => {
    expect(resolveToken("screen", "s1", io({ storage: null, search: "?token=abc" }))).toBe("abc");
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(resolveToken("screen", "s1", io({ storage: throwing, search: "?token=abc" }))).toBe("abc");
    expect(resolveToken("screen", "s1", io({ storage: throwing }))).toBe("");
  });

  test("returns an empty string when there is no token anywhere", () => {
    expect(resolveToken("host", "s1", io())).toBe("");
    expect(resolveToken("host", "s1", io({ storage: null }))).toBe("");
  });
});
