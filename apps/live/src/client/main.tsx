import { createRoot } from "react-dom/client";
import { GuestApp } from "./guest/GuestApp";
import { HostApp } from "./host/HostApp";
import "./styles.css";

function Router() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  const id = parts[1];
  if (parts[0] === "s" && id && parts.length === 2) return <GuestApp sessionId={id} />;
  if (parts[0] === "host" && id && parts.length === 2) {
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    return <HostApp sessionId={id} token={token} />;
  }
  return <p className="note">URL が正しくありません</p>;
}

createRoot(document.getElementById("root")!).render(<Router />);
