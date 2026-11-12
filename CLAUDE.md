# CLAUDE.md

This file provides guidance to Claude Code at claude.ai/code when working with code in this repository.

## 概要

結婚式の余興で使う 4 択クイズシステム。pnpm モノレポで、アプリの説明・ローカル開発の入口・デプロイ文書へのリンクはルートの [README.md](README.md) を正とする。

**要件の正は `docs/requirements/`**。中身は企画書・行動シナリオ・UI作成・手書きスケッチで、入口は `docs/requirements/README.md`。設計はそれに合わせて改訂した `docs/superpowers/specs/2026-10-25-wedding-quiz-design.md` にあり、食い違ったときは `docs/requirements/` を優先する。設計書の「未決事項」の節に、資料と現在の実装が食い違っている点をまとめてある。実装計画は `docs/superpowers/plans/` にある。

- `apps/live`: 当日の進行を担う Cloudflare Workers + Durable Object + React のアプリ。詳細は [apps/live/README.md](apps/live/README.md)、デプロイは [docs/deploy/live.md](docs/deploy/live.md)。
- `apps/admin`: Rails 8.1 の管理画面。問題の CRUD、開催回の作成、幹事 ID/PASS の発行をする。結果の取り込み・保存はしない。`ranking` は呼ばない。詳細は [apps/admin/README.md](apps/admin/README.md)、デプロイは [docs/deploy/admin.md](docs/deploy/admin.md)。テストは RSpec で、`apps/admin` で `bundle exec rspec` を実行する。PostgreSQL が要る。テストデータは fixtures でなく `spec/factories/` の factory_bot で作る。CI は `.github/workflows/admin-test.yml`。

**最優先の品質は「本番中にアクセス集中で進行が止まらないこと」**。想定は 1 開催回あたり最大 120 人程度で、負荷試験は 150 接続。当日はゲストのアクセスが Rails に届かない構成にしている。

## コマンド

ルートから `pnpm --filter live <script>`、または `apps/live` で `pnpm <script>`。スクリプト一覧と説明は [apps/live/README.md](apps/live/README.md) を見る。`deploy` は pnpm 組み込みと名前が重なるので `pnpm --filter live run deploy` と `run` を付ける。

`apps/live` で単一テストを実行する例:

```
pnpm exec vitest run src/worker/game/state.test.ts
pnpm exec vitest run --config vitest.workers.config.ts test/worker/socket.test.ts
```

`test/worker/load.test.ts` は 150 ゲスト + 1 ホスト + 1 投影画面を同一プロセスでつなぎ、問題の advance では全員への `guest_view`、表彰台の操作では `host_view` / `screen_view` が 2000 ms 以内に届くことと、ゲストが `results_pending` のままであることを確認する。

## apps/live のアーキテクチャ

1 つの Worker がフロントの静的アセット配信と API / WebSocket を兼ねる。`wrangler.jsonc` の `run_worker_first: ["/api/*", "/ws/*"]` に当たるものは Worker が処理し、それ以外は SPA フォールバックになる。

- `src/worker/index.ts`: Hono による入口。
  - 開催回の作成の `PUT /api/sessions/:id` と `GET /api/sessions/:id/ranking` は `Authorization: Bearer <ADMIN_API_SECRET>` で保護。`PUT` は Rails から呼ばれる想定。`ranking` は管理画面からは呼ばない。結果の取り込み・保存は作らない。
  - `GET /ws/:id/host?token=...` はホストトークンを検証する。値は `HMAC-SHA256(ADMIN_API_SECRET, sessionId)` を hex にしたもの。`GET /ws/:id/screen?token=...` は投影画面トークンを検証する。値は `HMAC-SHA256(ADMIN_API_SECRET, "screen:" + sessionId)` を hex にしたもの。互いのトークンでは入れない。`/ws/:id/guest` は認証なし。
  - 開催回 ID は `/^[A-Za-z0-9_-]{1,100}$/` のみ。`PUT` で検証する。`:` を許さないので host / screen のトークンの入力が衝突しない。
  - `ADMIN_API_SECRET` が未設定・短すぎる場合は fail closed で、500 を返す。
  - role は Worker が決めて `ROLE_HEADER` で DO に渡す。クライアントが送った値は上書きする。
  - DO は `getByName(sessionId, { locationHint: "apac-ne" })` で開催回ごとに 1 インスタンス。
- `src/worker/session-room.ts` の `SessionRoom` DO: WebSocket Hibernation API を使う。状態は `GameState` 1 つを `ctx.storage.kv` の `"state"` キーに丸ごと保存。ソケットの role と playerId は `serializeAttachment` に持つ。role は `host` / `screen` / `guest` のいずれか。ping/pong は `setWebSocketAutoResponse` で DO を起こさずに返す。誰に何を送るかは `deliver()` に集約されている。
- `src/worker/game/`: 純関数のゲームロジック。`state.ts` の遷移関数は `joinPlayer` / `submitAnswer` / `advance` / `presentResults` で、`Transition` を返し、通知先は決めない。`Transition` は新しい state と `GameEvent[]`、または失敗理由を持つ。`views.ts` が state から幹事用の `hostView`、投影画面用の `screenView`、ゲスト用のビューを作る。ゲストには順位を送らず、投影画面には幹事が投影した順位・名前だけを出すといったネタバレ防止はここで行う。`ranking.ts` は同点同順位の順位付け。
- `src/shared/types.ts`: Worker とクライアントで共有する型。`Phase`、`HostView`、`ScreenView`、`GuestView`、メッセージを含む。問題フェーズの `PhaseKey` は `lobby` / `q:<i>:<open|closed|revealed>` の形で、ホストが `advance.from` として送り返し、結果フェーズは `r:list` / `r:<playerId>:<hidden|rank|name|both>` を `results_action.from` でも使う。サーバーは現在のキーと照合して冪等にする。**問題フェーズのエンコーディングを変えないこと。**
- `src/worker/payload.ts`: 開催回作成時のクイズ JSON を zod で検証。
- `src/client/`: React。`main.tsx` が 3 つの URL を振り分ける。`/s/:id` はゲスト。`/host/:id` は幹事画面で、手元で進行操作と確認をし、会場には映さない。`/screen/:id` は投影画面で、プロジェクター用の別の PC で開き、操作せず幹事の操作に従う。ホストトークン・投影画面トークンは URL から sessionStorage に移してアドレスバーから消す。実装は `common/lib/token-store.ts`。ゲストは `playerToken` を保存して再接続時に同じ参加者として復帰する。共通の再接続処理は `common/lib/reconnecting-socket.ts` / `common/hooks/useLiveSocket.ts`。

進行状態はすべてサーバーである DO が持ち、ブラウザ側では持たない。開催回の作成時に受け取った問題一式をその開催回の間ずっと使う。

## apps/live のディレクトリ構成

`src/` は次の 4 つに分ける。

- `client/`: ブラウザで動く React。
- `worker/`: Worker と Durable Object。
- `shared/`: Worker とクライアントの両方が使う型と定数。
- `loadtest/`: 負荷試験の補助。

`src/client/` の構成は次のとおり。

```
src/client/
├── main.tsx          # エントリ。index.html が参照する。URL で 3 画面に振り分けるだけ
├── styles.css
├── common/           # 3 画面で共有するもの。src/shared/ と区別するため common とする
│   ├── hooks/        #   useLiveSocket.ts
│   └── lib/          #   reconnecting-socket / socket-url / permanent-ws-error / route / token-store / choice-labels
├── guest/            # 参加者の画面
├── host/             # 幹事の画面。ログインを含む
└── screen/           # 投影画面
```

`guest/` `host/` `screen/` は、それぞれ次の 3 つに分ける。ある画面専用のものはその画面の下に置く。2 つ以上の画面、または `main.tsx` が使うものは `common/` に置く。`common/` の他の部品だけが使うものも `common/` に置く。例は `useLiveSocket` だけが使う `reconnecting-socket`。

- `*App.tsx`: 画面の入口。どの画面を出すかだけを決める。直下に置く。
- `components/`: `.tsx` のコンポーネント。分岐やロジックを持つものは 1 ファイル 1 コンポーネント。画面の中の役割ごとに、下にサブディレクトリを切ってよい。例は `components/views/`。
- `hooks/`: `useXxx.ts` のカスタムフック。1 つしかなくても `hooks/` を作る。
- `lib/`: React に依存しない `.ts` の純関数・定数。純関数がない画面では作らない。
- 画面専用の型は、その画面の直下の `types.ts` に置く。Worker と共有する型は `src/shared/` に置く。

ファイル名は次の規約に従う。

| 種類 | 名前 | 例 |
|---|---|---|
| コンポーネント | PascalCase の `.tsx` | `GuestScreen.tsx` |
| カスタムフック | `useXxx.ts` | `useGuestSession.ts` |
| 純関数・定数 | kebab-case の `.ts` | `host-action.ts` |

テストは対象のファイルの隣に `<対象>.test.ts` として置く。例は `src/client/host/lib/host-action.test.ts`。node 環境で動く単体テストはすべてこの方式にする。miniflare 上の Workers ランタイムで動かす統合テストは、特定の 1 ファイルに対応しないので `test/worker/` に置く。`test/` に置くのは `test/worker/` の統合テストだけで、旧 `test/game/` と `test/client/` には足さない。置いてしまった単体テストも node 側の vitest が拾うが、対象の隣へ移す。

## apps/live の import の書き方

`src/` の 3 つのディレクトリにはエイリアスがある。`@client/*` は `src/client/*`、`@shared/*` は `src/shared/*`、`@worker/*` は `src/worker/*` を指す。

- ディレクトリをまたぐ import は、同じトップレベルの中でもエイリアスで書く。例は `import { CHOICE_LABELS } from "@client/common/lib/choice-labels"`。
- 同じディレクトリか、その子のディレクトリへの `./` の import は相対のままにする。同じ画面の中で近くのファイルを指すときは、移動しても壊れにくく読みやすい。
- 親ディレクトリへの `../` は書かない。oxlint の `no-restricted-imports` がエラーにする。
- エイリアスの定義は `apps/live/tsconfig.paths.json` の 1 か所だけにある。`tsconfig.json` と `scripts/tsconfig.json` はこれを `extends` する。Vite と vitest は `resolve.tsconfigPaths` で、Wrangler の bundle は esbuild の tsconfig 対応で、同じ定義を読む。エイリアスを足すときはこのファイルだけを直す。
- `scripts/` は Node が型を消して直接実行するので、エイリアスを解決できない。`scripts/` 自身は `../src/` への相対で書く。
- `scripts/` から読まれる `src/` のファイルは `src/worker/auth.ts` と `src/loadtest/` の下で、ここでは値の import にエイリアスを使えない。値は相対で書き、エイリアスは `import type` でだけ使う。`.oxlintrc.json` の override がこの 2 か所の値の import をエラーにする。`scripts/` から読むファイルを増やしたら、その override の `files` にも足す。
- 型の import は `import type { X } from "..."` と書く。`import { type X } from "..."` は型を消すと `import {} from "..."` が残り、Node の型を消す実行では空の import が実在のモジュールを探して `ERR_MODULE_NOT_FOUND` になる。oxlint の `typescript/no-import-type-side-effects` が全体でエラーにする。
- `src/loadtest/` と `fixtures/` を指すエイリアスはない。`test/worker/load.test.ts` だけは相対で読み、`no-restricted-imports` の対象から外している。

## apps/live のコードの書き方

- 関数はすべて `const` のアロー関数で書く。oxlint の `func-style` で検査する。クラスのメソッドは対象外。
- 分岐やロジックを持つコンポーネントは 1 ファイル 1 コンポーネントにし、ファイル名はコンポーネント名に合わせ、PascalCase にする。App 系のファイルは「どの画面を出すか」だけを決める。
- 分岐もロジックも持たない表示だけの部品は切り出さず、呼び出し元の `return` に直接書く。
- JSX は `return` の中にだけ書く。変数代入、`useMemo`、ヘルパー関数の中では組み立てない。`switch` で複数の `return <X />` を書くのは可。lint では検査できないのでレビューで確認する。
- `return` より前に書くのは hook 呼び出しと単純な派生値だけ。状態・ソケット・タイマー・キーボード・DOM 計測などのロジックは `useXxx.ts` のカスタムフックか `.ts` の純関数に出す。
- 三項演算子のネストは 1 段まで。それ以上は `switch` で選ぶ小さなコンポーネントに分ける。

## 注意点

- `pnpm-workspace.yaml` の `minimumReleaseAge: 10080` により、公開から 7 日未満のパッケージバージョンはインストールできない。
- **本番の進行中は絶対にデプロイしない**。全員の WebSocket が切れるため。
- `ADMIN_API_SECRET` は Rails 側と同じ値にする。本番は 32 文字以上で、`wrangler secret put ADMIN_API_SECRET` で設定する。
- 本番デプロイは `release.yml` で Draft Release を作り、人が画面で公開すると `admin-deploy` / `live-deploy` が動く。タグは `app-YYYYMMDD-HHMM` / `live-YYYYMMDD-HHMM`。`main` への push ではデプロイしない。当日の進行中は公開しない。手順と本番前チェックリストは `docs/deploy/` の live と admin にある。


