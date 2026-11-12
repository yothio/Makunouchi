import { createRoot } from "react-dom/client";
import { GuestApp } from "./guest/GuestApp";
import { HostGate } from "./host/components/HostGate";
import { ScreenApp } from "./screen/ScreenApp";
import { matchRoute } from "./common/lib/route";
import { resolveToken, type TokenRole } from "./common/lib/token-store";
import "./styles.css";

const tokenFor = (role: TokenRole, sessionId: string): string => {
  let storage: Storage | null = null;
  try {
    storage = sessionStorage;
  } catch {
  }
  return resolveToken(role, sessionId, {
    search: window.location.search,
    pathname: window.location.pathname,
    hash: window.location.hash,
    storage,
    replaceUrl: (url) => history.replaceState(null, "", url),
  });
};

const Router = () => {
  const match = matchRoute(window.location.pathname);
  switch (match?.route) {
    case "guest":
      return <GuestApp sessionId={match.id} />;
    case "host":
      return <HostGate sessionId={match.id} initialToken={tokenFor("host", match.id)} />;
    case "screen":
      return <ScreenApp sessionId={match.id} token={tokenFor("screen", match.id)} />;
    default:
      return <p className="note">URL が正しくありません</p>;
  }
};

createRoot(document.getElementById("root")!).render(<Router />);
