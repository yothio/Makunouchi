# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

結婚式の余興で使う 4 択クイズシステム（pnpm モノレポ）。**要件の正は `docs/requirements/`**（企画書・行動シナリオ・UI作成・手書きスケッチ。入口は `README.md`）。設計はそれに合わせて改訂した `docs/superpowers/specs/2026-10-25-wedding-quiz-design.md` にあり、食い違ったときは `docs/requirements/` を優先する。設計書の「未決事項」の節に、資料と現在の実装が食い違っている点をまとめてある。実装計画は `docs/superpowers/plans/` にある。

- `apps/live`: 当日の進行を受け持つ Cloudflare Workers + Durable Object + React。現在あるのはこれだけ。
- `apps/admin`: Rails 8 の管理画面（式・問題の CRUD、開催回の作成と幹事 ID/PASS の発行。結果の取り込み・保存はしない）。設計上の予定で、まだ存在しない。

**最優先の品質は「本番中にアクセス集中で進行が止まらないこと」**（1 開催回あたり最大 120 人程度、負荷試験は 150 接続）。当日はゲストのアクセスが Rails に届かない構成にしている。

## コマンド

ルートから `pnpm --filter live <script>`、または `apps/live` で `pnpm <script>`。

- `dev`: Vite + `@cloudflare/vite-plugin` でローカル起動（http://localhost:5173）。事前に `cp apps/live/.dev.vars.sample apps/live/.dev.vars`。`.dev.vars` は起動時にしか読まれない。
- `test`: Node 環境（`vitest.config.ts`: `test/{game,client}`）と Workers 環境（`vitest.workers.config.ts`: `test/worker`、`@cloudflare/vitest-plugin`）を順に実行する。
- `typecheck`: `tsc --noEmit`（本体と `scripts/` の 2 つの tsconfig）。
- `lint` / `lint:fix`: oxlint（`.oxlintrc.json`）。
- `build` / `deploy`（`vite build && wrangler deploy`）。
- `seed <baseUrl> [quiz.json]`: `fixtures/sample-quiz.json` で開催回を作り、ゲスト URL・幹事画面 URL・投影画面 URL を表示する。`ADMIN_API_SECRET` 環境変数が必要。
- `loadtest <baseUrl> <sessionId> --clients 150`: ロビー状態の新しい開催回に対して実行する（開催回は戻せないので毎回 `seed` し直す）。

単一テストの実行（`apps/live` で）:

```
pnpm exec vitest run test/game/state.test.ts                                   # Node 環境
pnpm exec vitest run --config vitest.workers.config.ts test/worker/socket.test.ts  # Workers 環境
```

`test/worker/load.test.ts` は 150 ゲスト + 1 ホストを同一プロセスでつなぎ、advance ごとに全員へ 2000 ms 以内に `guest_view` が届くことを確認する。

## アーキテクチャ（apps/live）

1 つの Worker がフロントの静的アセット配信と API / WebSocket を兼ねる（`wrangler.jsonc` の `run_worker_first: ["/api/*", "/ws/*"]`、それ以外は SPA フォールバック）。

- `src/worker/index.ts`（Hono）: 入口。
  - `PUT /api/sessions/:id`（開催回の作成）と `GET /api/sessions/:id/ranking` は `Authorization: Bearer <ADMIN_API_SECRET>` で保護。`PUT` は Rails から呼ばれる想定。`ranking` は管理画面からは呼ばない（結果の取り込み・保存は作らない）。
  - `GET /ws/:id/host?token=...` はホストトークン `HMAC-SHA256(ADMIN_API_SECRET, sessionId)`（hex）、`GET /ws/:id/screen?token=...` は投影画面トークン `HMAC-SHA256(ADMIN_API_SECRET, "screen:" + sessionId)`（hex）を検証。互いのトークンでは入れない。`/ws/:id/guest` は認証なし。
  - 開催回 ID は `/^[A-Za-z0-9_-]{1,100}$/` のみ（`PUT` で検証。`:` を許さないので host / screen のトークンの入力が衝突しない）。
  - `ADMIN_API_SECRET` が未設定・短すぎる場合は fail closed（500）。
  - role は Worker が決めて `ROLE_HEADER` で DO に渡す（クライアントが送った値は上書き）。
  - DO は `getByName(sessionId, { locationHint: "apac-ne" })` で開催回ごとに 1 インスタンス。
- `src/worker/session-room.ts`（`SessionRoom` DO）: WebSocket Hibernation API を使う。状態は `GameState` 1 つを `ctx.storage.kv` の `"state"` キーに丸ごと保存。ソケットの role（`host` / `screen` / `guest`）/ playerId は `serializeAttachment` に持つ。ping/pong は `setWebSocketAutoResponse` で DO を起こさずに返す。誰に何を送るかは `deliver()` に集約されている。
- `src/worker/game/`: 純関数のゲームロジック。`state.ts` の遷移関数（`joinPlayer` / `submitAnswer` / `advance` / `presentResults`）は `Transition`（新しい state と `GameEvent[]`、または失敗理由）を返し、通知先は決めない。`views.ts` が state から幹事用（`hostView`）・投影画面用（`screenView`）・ゲスト用のビューを作る（ゲストには順位を送らず、投影画面には幹事が投影した順位・名前だけを出す等のネタバレ防止はここ）。`ranking.ts` は同点同順位の順位付け。
- `src/shared/types.ts`: Worker とクライアントで共有する型（`Phase`、`HostView`、`ScreenView`、`GuestView`、メッセージ）。問題フェーズの `PhaseKey`（`lobby` / `q:<i>:<open|closed|revealed>`）はホストが `advance.from` として送り返し、結果フェーズは `r:list` / `r:<playerId>:<hidden|rank|name|both>` を `results_action.from` でも使う。サーバーは現在のキーと照合して冪等にする。**問題フェーズのエンコーディングを変えないこと。**
- `src/worker/payload.ts`: 開催回作成時のクイズ JSON を zod で検証。
- `src/client/`: React。`main.tsx` が `/s/:id`（ゲスト）、`/host/:id`（幹事画面。手元で進行操作と確認。会場には映さない）、`/screen/:id`（投影画面。プロジェクター用の別の PC で開き、操作せず幹事の操作に従う）を振り分ける。ホストトークン・投影画面トークンは URL から sessionStorage に移してアドレスバーから消す（`token-store.ts`）。ゲストは `playerToken` を保存して再接続時に同じ参加者として復帰する。共通の再接続処理は `reconnecting-socket.ts` / `use-live-socket.ts`。

進行状態はすべてサーバー（DO）が持ち、ブラウザ側では持たない。開催回の作成時に受け取った問題一式をその開催回の間ずっと使う。

## コードの書き方（apps/live）

- 関数はすべて `const` のアロー関数で書く（oxlint の `func-style` で検査。クラスのメソッドは対象外）。
- 分岐やロジックを持つコンポーネントは 1 ファイル 1 コンポーネントにし、ファイル名はコンポーネント名（PascalCase）に合わせる。App 系のファイルは「どの画面を出すか」だけを決める。
- 分岐もロジックも持たない表示だけの部品は切り出さず、呼び出し元の `return` に直接書く。
- JSX は `return` の中にだけ書く（変数代入、`useMemo`、ヘルパー関数の中で組み立てない。`switch` で複数の `return <X />` は可）。lint では検査できないのでレビューで確認する。
- `return` より前に書くのは hook 呼び出しと単純な派生値だけ。状態・ソケット・タイマー・キーボード・DOM 計測などのロジックは `useXxx.ts` のカスタムフックか `.ts` の純関数に出す。
- 三項演算子のネストは 1 段まで。それ以上は `switch` で選ぶ小さなコンポーネントに分ける。

## 注意点

- `pnpm-workspace.yaml` の `minimumReleaseAge: 10080` により、公開から 7 日未満のパッケージバージョンはインストールできない。
- **本番の進行中は絶対にデプロイしない**（全員の WebSocket が切れる）。
- `ADMIN_API_SECRET` は Rails 側と同じ値にする（本番は 32 文字以上、`wrangler secret put ADMIN_API_SECRET`）。
- デプロイ手順と本番前チェックリストは `apps/live/README.md` にある。
