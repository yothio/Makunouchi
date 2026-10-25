import type { SessionRoom } from "./session-room";

declare global {
  namespace Cloudflare {
    interface GlobalProps {
      mainModule: typeof import("./index");
      durableNamespaces: "SessionRoom";
    }
    interface Env {
      SESSION_ROOM: DurableObjectNamespace<SessionRoom>;
      ADMIN_API_SECRET: string;
      ASSETS: Fetcher;
    }
  }
  interface Env extends Cloudflare.Env {}
}
