import { createRoot } from "react-dom/client";
import { GuestApp } from "./guest/GuestApp";
import { HostApp } from "./host/HostApp";
import "./styles.css";

/**
 * The host token is a credential and the projector shows the URL bar: move it from the query string
 * into sessionStorage (so a reload still works) and strip it from the address.
 */
function resolveHostToken(sessionId: string): string {
  const key = `makunouchi:${sessionId}:hostToken`;
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get("token");
  if (fromUrl) {
    try {
      sessionStorage.setItem(key, fromUrl);
    } catch {
      // storage unavailable; token only lives for this page load
    }
    params.delete("token");
    const qs = params.toString();
    history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash);
    return fromUrl;
  }
  try {
    return sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function Router() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  const id = parts[1];
  if (parts[0] === "s" && id && parts.length === 2) return <GuestApp sessionId={id} />;
  if (parts[0] === "host" && id && parts.length === 2) {
    return <HostApp sessionId={id} token={resolveHostToken(id)} />;
  }
  return <p className="note">URL が正しくありません</p>;
}

createRoot(document.getElementById("root")!).render(<Router />);
