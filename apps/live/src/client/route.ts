import { PatternRouter } from "hono/router/pattern-router";

export type Route = "guest" | "host" | "screen";

export type RouteMatch = { route: Route; id: string };

const ROUTES: readonly (readonly [path: string, route: Route])[] = [
  ["/s/:id", "guest"],
  ["/host/:id", "host"],
  ["/screen/:id", "screen"],
];

// Pattern / Linear / Trie のうち client のバンドルが最も小さい。RegExp / Smart は params が index マップで取り出しに手間が要るので使わない
const router = new PatternRouter<Route>();
for (const [path, route] of ROUTES) router.add("GET", path, route);

export const matchRoute = (pathname: string): RouteMatch | null => {
  // 手書きの split 時代と同じく、末尾や重複のスラッシュは無視する（router は厳密に照合するため）
  const normalized = `/${pathname.split("/").filter(Boolean).join("/")}`;
  const [[hit]] = router.match("GET", normalized);
  if (!hit) return null;
  const [route, params] = hit;
  return { route, id: String(params.id) };
};
