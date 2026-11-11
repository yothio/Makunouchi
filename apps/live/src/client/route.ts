export type Route = "guest" | "host" | "screen";

export type RouteMatch = { route: Route; id: string };

const ROUTE_BY_PREFIX: Record<string, Route> = {
  s: "guest",
  host: "host",
  screen: "screen",
};

export const matchRoute = (pathname: string): RouteMatch | null => {
  const parts = pathname.split("/").filter(Boolean);
  const [prefix, id] = parts;
  if (parts.length !== 2 || !Object.hasOwn(ROUTE_BY_PREFIX, prefix)) return null;
  return { route: ROUTE_BY_PREFIX[prefix], id };
};
