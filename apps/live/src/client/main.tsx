import { createRoot } from "react-dom/client";
import { GuestApp } from "./guest/GuestApp";
import { HostGate } from "./host/HostGate";
import { ScreenApp } from "./screen/ScreenApp";
import { resolveToken, type TokenRole } from "./token-store";
import "./styles.css";

const tokenFor = (role: TokenRole, sessionId: string): string => {
  let storage: Storage | null = null;
  try {
    storage = sessionStorage;
  } catch {
    // storage blocked
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
  const parts = window.location.pathname.split("/").filter(Boolean);
  const id = parts[1];
  if (parts[0] === "s" && id && parts.length === 2) return <GuestApp sessionId={id} />;
  if (parts[0] === "host" && id && parts.length === 2) {
    return <HostGate sessionId={id} initialToken={tokenFor("host", id)} />;
  }
  if (parts[0] === "screen" && id && parts.length === 2) return <ScreenApp sessionId={id} token={tokenFor("screen", id)} />;
  return <p className="note">URL が正しくありません</p>;
};

createRoot(document.getElementById("root")!).render(<Router />);
