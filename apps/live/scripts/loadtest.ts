import WebSocket from "ws";
import { hostTokenFor } from "../src/worker/auth.ts";
import { driveQuiz, type Sock } from "../src/loadtest/drive.ts";
import { normalizeBase, requireSecret } from "./env.ts";

const secret = requireSecret();
const args = process.argv.slice(2);
const flag = args.indexOf("--clients");
const clients = flag >= 0 ? Number(args.splice(flag, 2)[1]) : 150;
const base = normalizeBase(args[0]);
const sessionId = args[1];
if (!sessionId || !Number.isInteger(clients) || clients < 1) {
  console.error("usage: loadtest <baseUrl> <sessionId> [--clients N]");
  process.exit(1);
}

const wsBase = new URL(base);
wsBase.protocol = base.protocol === "https:" ? "wss:" : "ws:";

const open = (path: string): Promise<Sock> => {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(new URL(path, wsBase));
    const early: string[] = [];
    let cb: ((d: string) => void) | null = null;
    ws.on("message", (d) => {
      const s = d.toString();
      if (cb) cb(s);
      else early.push(s);
    });
    ws.once("error", reject);
    ws.once("open", () =>
      resolve({
        send: (d) => ws.send(d),
        onMessage(f) {
          cb = f;
          early.splice(0).forEach(f);
        },
        close: () => ws.close(),
      }),
    );
  });
};

const token = await hostTokenFor(secret, sessionId);
const host = await open(`/ws/${sessionId}/host?token=${token}`);
const guests = await Promise.all(Array.from({ length: clients }, () => open(`/ws/${sessionId}/guest`)));
console.log(`connected: 1 host + ${clients} guests`);

const result = await driveQuiz({ host, guests, log: console.log });
console.log("");
for (const a of result.advances) console.log(`${a.from.padEnd(12)} -> ${a.to.padEnd(12)} max ${String(Math.round(a.maxMs)).padStart(5)} ms  missing ${a.missing}`);
console.log(`\nworst p100: ${Math.round(result.worstMs)} ms, missing total: ${result.totalMissing}`);
console.log(result.pass ? "PASS" : "FAIL");
guests.forEach((g) => g.close());
host.close();
process.exit(result.pass ? 0 : 1);
