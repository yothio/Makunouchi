import { DurableObject } from "cloudflare:workers";

export class SessionRoom extends DurableObject<Env> {}
