import { createRoot } from "react-dom/client";
import { GuestApp } from "./guest/GuestApp";
import "./styles.css";

function Router() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  const id = parts[1];
  if (parts[0] === "s" && id && parts.length === 2) return <GuestApp sessionId={id} />;
  if (parts[0] === "host" && id && parts.length === 2) return <p>投影画面（Task 7）</p>;
  return <p className="note">URL が正しくありません</p>;
}

createRoot(document.getElementById("root")!).render(<Router />);
