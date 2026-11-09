# live（当日進行）

結婚式クイズのライブアプリです。1 開催回の進行状態を Durable Object（`SessionRoom`）が持ち、幹事画面・投影画面・参加者スマホを WebSocket でつなぎます。1 開催回あたり最大 120 人程度を想定し、負荷試験は 150 接続です。

問題と開催回の準備は [`apps/admin`](../admin/README.md) が行い、結果の取り込み・保存はしません。デプロイ手順は [docs/deploy/live.md](../../docs/deploy/live.md) です。

## 技術構成

- Cloudflare Workers + Durable Object + React（Vite、`@cloudflare/vite-plugin`）
- API / WebSocket 入口は Hono（`src/worker/index.ts`）
- 1 Worker が静的アセットと `/api/*`・`/ws/*` を兼ねる（`wrangler.jsonc` の `run_worker_first`）

## 主な画面と API

| 経路 | 役割 |
| --- | --- |
| `/s/:id` | ゲスト（ニックネーム参加・回答） |
| `/host/:id` | 幹事画面（手元で進行。会場には映さない） |
| `/screen/:id` | 投影画面（プロジェクター用。操作せず幹事に従う） |
| `PUT /api/sessions/:id` | 開催回の作成（Bearer `ADMIN_API_SECRET`。admin から） |
| `GET /api/sessions/:id/ranking` | ランキング取得（admin は呼ばない） |
| `POST /api/host-login/:id` | 幹事 ID/PASS ログイン |
| `/ws/:id/guest` | ゲスト WebSocket（認証なし） |
| `/ws/:id/host` | 幹事 WebSocket（HMAC トークン） |
| `/ws/:id/screen` | 投影 WebSocket（screen 用 HMAC トークン） |

幹事は通常、表示された ID/パスワードで `/host/:id` に入ります。トークン付き URL は開発・緊急時・ログイン失敗でロックされたときの非常口です。ホスト／投影トークンは URL から sessionStorage に移してアドレスバーから消します。

## ローカル開発

必要なもの: Node 22 以上（CI は 24）、pnpm（ルートの `packageManager` に従う）。

1. `apps/live/.dev.vars.sample` をコピーして `.dev.vars` を作る（git 管理外）。

   ```
   cp apps/live/.dev.vars.sample apps/live/.dev.vars
   ```

   `.dev.vars` は起動時にだけ読み込まれるので、作成・変更したら `pnpm --filter live dev` を再起動する。

2. 起動する（既定は <http://localhost:5173>）。

   ```
   pnpm --filter live dev
   ```

3. 開催回を作る（`ADMIN_API_SECRET` は `.dev.vars` と同じ値）。

   ```
   ADMIN_API_SECRET=dev-secret-change-me-0123456789abcdef pnpm --filter live seed http://localhost:5173
   ```

   `fixtures/sample-quiz.json`（5 問 + 幹事 `host`）を登録し、sessionId、ゲスト URL、幹事画面 URL、幹事トークン URL（緊急時）、投影画面 URL、幹事 ID/PASS を表示します。別の問題ファイルを使うときは第 2 引数に JSON のパスを渡します。`host` を省略した JSON でも従来どおり作れます（その場合はトークン URL のみ）。

### よく使うコマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm --filter live test` | Node 環境と Workers 環境のテスト |
| `pnpm --filter live typecheck` | `tsc --noEmit`（本体と `scripts/`） |
| `pnpm --filter live lint` / `lint:fix` | oxlint（`.oxlintrc.json`） |
| `pnpm --filter live build` | Vite ビルド |
| `pnpm --filter live seed <baseUrl> [quiz.json]` | 開催回を作って URL を表示 |
| `pnpm --filter live loadtest <baseUrl> <sessionId> --clients 150` | ロビー状態の開催回に対する負荷試験 |

単一テストは `apps/live` で次のように実行します。

```
pnpm exec vitest run test/game/state.test.ts
pnpm exec vitest run --config vitest.workers.config.ts test/worker/socket.test.ts
```

`test/worker/load.test.ts` は同一プロセス内で 150 ゲスト + 1 ホスト + 1 投影画面を接続し、問題の advance では全員への `guest_view`、表彰台の操作では `host_view` / `screen_view` が 2000 ms 以内に届くことと、ゲストが `results_pending` のままであることを確認します。

負荷試験は開催回を 1 回進めると戻せないので、試験のたびに `seed` し直します。本番 URL 向けの seed / loadtest と当日の注意は [docs/deploy/live.md](../../docs/deploy/live.md) を見てください。

### よくあるつまずき

- `.dev.vars` を変えたのに反映されない → 開発サーバーを再起動する
- `pnpm deploy` が失敗する → デプロイは `pnpm --filter live run deploy`（`run` 必須）。手順はデプロイ文書へ
- seed が 500 → `.dev.vars` の `ADMIN_API_SECRET` が未設定か短すぎる（32 文字未満は本番と同様 fail closed）

## コンポーネントの書き方

- 分岐やロジックを持つコンポーネントは 1 ファイル 1 コンポーネントにし、ファイル名はコンポーネント名（PascalCase）に合わせる。App 系は「どの画面を出すか」だけを決める
- 表示だけの部品は切り出さず、呼び出し元の `return` に直接書く
- JSX は `return` の中にだけ書く（`switch` で複数の `return <X />` は可）
- `return` より前は hook と単純な派生値だけ。状態・ソケット・タイマー等は `useXxx.ts` か純関数へ
- 三項演算子のネストは 1 段まで
- 関数はすべて `const` のアロー関数（oxlint `func-style`。クラスのメソッドは対象外）

## デプロイ

初回デプロイ、secret、GitHub Actions（Draft Release を公開すると動く `live-deploy.yml`。タグは `live-YYYYMMDD-HHMM`）、ロールバック、本番前チェックリストは [docs/deploy/live.md](../../docs/deploy/live.md) にまとめています。


本番の進行中は Draft を公開しないでください。全員の WebSocket が切れます。
