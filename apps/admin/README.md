# apps/admin（管理画面）

結婚式クイズの管理画面（Rails 8）。システム管理者・主催者が問題と開催回を準備する。当日の進行は `apps/live` が受け持つ。結果の取り込み・保存はしない（`ranking` API も呼ばない）。
計画は `docs/superpowers/plans/2026-11-07-admin.md`。

> **admin は Rails のみ。JS パッケージにしない。** ルートの `pnpm-workspace.yaml` は `apps/*` を対象にするが、`apps/admin` に `package.json` を置かない限り無視される。置かないこと。

## 構成

- DB は Neon の PostgreSQL の **primary 1 つだけ**。cache / queue 用の別 DB は持たない。
- キャッシュはメモリ（`:memory_store`）、Active Job は `:async`。`solid_cache` / `solid_queue` は使わない。
- 画像は Cloudflare R2（S3 互換）。本番はブラウザから R2 に直接アップロードする（Active Storage の direct upload）。
- デプロイは Cloud Run。Kamal は使わない。
- 待ち受けは `PORT`（Cloud Run が渡す。無いときの本番既定は 8080）。health は `/up`。

## 環境変数

秘密はすべて環境変数（または Secret Manager）で渡し、**リポジトリにコミットしない**。

| 変数 | 必須 | 用途 |
|---|---|---|
| `DATABASE_URL` | 本番必須 | アプリ用。Neon の **pooled** 接続 URL。Cloud Run **サービス**側にはこれだけ（direct は載せない） |
| `DATABASE_URL_DIRECT` | マイグレーション時 | Neon の **direct** 接続 URL。アプリ起動では読まない。migrate/seed 用 Job（または手元）で `DATABASE_URL` に差し替えて使う |
| `TEST_DATABASE_URL` | テスト推奨 | test の接続先。未設定ならローカルの `admin_test` |
| `RAILS_MASTER_KEY` | 本番必須 | `credentials.yml.enc` 解読用。リポジトリには入れない。**作成者のローカル** `apps/admin/config/master.key` を手元で読み、Secret Manager に一度だけ保存する。クローンしただけではファイルは無い。失うと credentials の再発行が必要 |
| `ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY` / `ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY` / `ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT` | 本番必須 | 幹事パスワード暗号化。**ローカル開発**で `bin/rails db:encryption:init` を実行し、表示された 3 値を本番 Secret へ移す（production イメージ上では回さない。鍵が無いと Rails が起動できない鶏卵になる）。失うと既存開催回の PASS が読めない |
| `R2_BUCKET` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_ENDPOINT` | 本番必須 | R2。欠けたら起動で落ちる |
| `R2_PUBLIC_BASE_URL` | 画像付き開催回 | 公開 https のベース（`{base}/{blob.key}`）。カスタムドメイン。`r2.dev` は本番向けでない |
| `ADMIN_API_SECRET` | live 連携必須 | live Worker と同じ値（本番は 32 文字以上）。PUT `/api/sessions/:id` の Bearer |
| `LIVE_BASE_URL` | live 連携必須 | Rails → Worker の API ベース（例: `https://makunouchi-live.<account>.workers.dev`） |
| `LIVE_PUBLIC_URL` | 本番で画面を使うなら必須 | 開催回詳細の参列者・幹事 URL の元。未設定だと URL が空（先頭が欠けたパス）になり、画面からコピーできない |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | 初回 seed | システム管理者 1 人。`ADMIN_PASSWORD` は **12 文字以上**。既に管理者がいれば seed は何もしない |
| `PORT` | Cloud Run が渡す | 待ち受け。無いときの既定は本番 8080、開発・テスト 3000 |
| `RAILS_LOG_LEVEL` | 任意 | 既定 `info` |
| `RAILS_MAX_THREADS` | 任意 | Puma スレッド（既定 3） |

## ローカルで動かす

開発・テストの Active Record Encryption の鍵は `config/environments/{development,test}.rb` に捨ての固定値で入れてある（本番の鍵とは無関係）。

ローカルの Postgres が要る（`DATABASE_URL` / `TEST_DATABASE_URL`、または `PGUSER` / `PGHOST` など）。

```
bin/setup --skip-server   # bundle install と db:prepare
PARALLEL_WORKERS=1 bin/rails test
bin/rails server          # http://localhost:3000
bin/rubocop               # 静的解析（直せるものは bin/rubocop -a）。CI は admin-lint
```

初回だけシステム管理者を作る例（パスワードは 12 文字以上）:

```
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='your-long-password' bin/rails db:seed
```

## マイグレーション

コンテナの起動時には `db:prepare` / `db:migrate` を流さない。Neon の pooled 接続（PgBouncer のトランザクションモード）はアドバイザリロックと相性が悪く、Cloud Run の複数インスタンスが同時に流すと競合するため。デプロイのたびに direct 接続で **1 回だけ** 流す（Cloud Run Jobs、またはデプロイ前の手動）。

**環境変数はアプリと同じものを渡し（`RAILS_MASTER_KEY`・`R2_*` 4 つ・Active Record Encryption の 3 つを含む。本番では `storage.yml` が起動時に読まれ、欠けると `KeyError`）、`DATABASE_URL` だけを direct に差し替える**:

```
DATABASE_URL="$DATABASE_URL_DIRECT" bin/rails db:migrate
```

## Cloud Run へのデプロイ

GCP コンソール（または同等の UI）での手作業を前提にする。`gcloud` の長いコマンド例は意図的に省略する（アカウント・リージョン・リポジトリ名が環境ごとに違うため）。初回は下の「ユーザーが手で行う初回設定」を済ませてから。

1. **イメージをビルド**（`apps/admin` で）:

   ```
   docker build -t admin .
   ```

2. Artifact Registry 等へタグ付けして push し、Cloud Run **サービス**を作成／リビジョン更新する。
3. **サービス設定の要点**:
   - コンテナポート: `8080`（または `PORT` に合わせる）
   - **Startup probe / Liveness probe**: HTTP `GET /up`（`force_ssl` は `/up` をリダイレクト除外済み）
   - 環境変数・Secret: 上表の本番必須項目。**`DATABASE_URL` は pooled だけ**（`DATABASE_URL_DIRECT` はサービスに常設しない）
   - 同時リクエスト数の既定（80）と Puma スレッド 3・DB `max_connections` 5 の前提を変えるときは三つを合わせて見直す
4. **デプロイごとに migrate を 1 回**（推奨: Cloud Run **Jobs**）:
   - サービスと **同じコンテナイメージ**を使う
   - 環境変数・Secret はサービスと同一にする
   - そのうえで Job だけ `DATABASE_URL` を **direct**（`DATABASE_URL_DIRECT` の値）に差し替える
   - コマンド: `bin/rails db:migrate`（起動エントリはサービスと同じでよい）
   - 手元で流す場合も同じ: イメージまたはローカルから、本番と同じ鍵一式＋`DATABASE_URL=<direct>` で `bin/rails db:migrate`
5. **初回だけ seed**（同様に Job または手元）:
   - `ADMIN_EMAIL` / `ADMIN_PASSWORD`（12 文字以上）を渡して `bin/rails db:seed`
   - 既にシステム管理者がいれば何もしない（冪等）
6. ブラウザでログインし、問題作成・開催回作成（live は stub または結合後の実 PUT）を確認

### Active Job（`:async`）について

ジョブは同一プロセス内で動く。Cloud Run のインスタンスが止まった瞬間に未完了ジョブは失われる。自前のジョブは無く、Active Storage の解析・削除程度なので、MVP ではこの欠落を許容する（計画どおり）。重要な処理をジョブに載せるなら別アダプタが要る。

## R2 の設定（コンソール作業）

- **バケット**を作り、オブジェクト読み取りを公開する（カスタムドメインで https）。
- **公開 URL** はカスタムドメイン（https）を `R2_PUBLIC_BASE_URL` に設定する（`r2.dev` は本番向けでない）。live の `imageUrl` は https 必須。
- **CORS**（direct upload 用）:
  - `AllowedOrigins`: 管理画面の本番オリジンのみ（開発用別バケットなら `http://localhost:3000`）
  - `AllowedMethods`: `PUT`
  - `AllowedHeaders`: `Content-Type` / `Content-MD5` / `Content-Disposition`（Rails 8.1 の `headers_for_direct_upload` を実機で確かめてから確定）
  - `MaxAgeSeconds` を付ける
- **aws-sdk-s3**: `config/storage.yml` でチェックサムを `when_required` にしている。実 R2 で画像の analyze / purge が通ることを確かめる。
- Content-Security-Policy を有効にする場合は `connect-src` に R2 エンドポイントを足す（雛形では CSP はコメントアウト）。

## live との結合

- `ADMIN_API_SECRET` は live（`wrangler secret`）と **同じ値**。
- Rails は `LIVE_BASE_URL` へ `PUT /api/sessions/:id`（Bearer）するだけ。`ranking` は呼ばない。
- **実 live への `host` 付き PUT**は、live 側の points/topN 削除と **幹事 ID/PASS ログイン（計画 Task 6）の両方のマージ後**に限る。それより前に送ると、古い live が `host` を捨てて 201 を返し、幹事認証が DO に残らず同じ ID では直せない（管理画面は `host_missing` にする）。
- 投影 URL（`/screen/...`）の表示は split-host-and-screen マージ後（決定 7）。

## ログインとセッション

- セッションは暗号化 cookie。有効期限は**最後に使ってから 8 時間**（使うたびに延びる）。cookie は HTTPS 限定・HttpOnly。
- **ログアウト**でそのユーザーの `users.sessions_valid_after` が更新され、それより前の全セッションが無効になる。
- ログイン試行は IP・メールごとに 3 分 10 回（超えたら 429）。回数はインスタンスごと。
- パスワード再設定機能は無い。忘れたときは管理者が DB で直す。

## 本番前チェックリスト

- [ ] `PORT` を尊重して待ち受けている（Cloud Run が渡す）
- [ ] `config.assume_ssl = true` と `force_ssl`（`/up` は除外）
- [ ] Startup / Liveness probe が `GET /up`
- [ ] Cloud Run **サービス**の `DATABASE_URL` は pooled だけ（direct は Job／手元の migrate 時だけ）
- [ ] デプロイごとに migrate を 1 回だけ流した（起動時には流していない）
- [ ] 初回 `db:seed` で管理者を作った（`ADMIN_PASSWORD` 12 文字以上）
- [ ] Active Record Encryption の 3 鍵を（ローカルで生成し）Secret に入れ、バックアップした
- [ ] `RAILS_MASTER_KEY` を作成者ローカルの `master.key` から Secret に入れた（リポジトリには無い）
- [ ] R2 の 4 変数 + `R2_PUBLIC_BASE_URL`（https）
- [ ] R2 CORS が管理画面オリジンのみ
- [ ] `ADMIN_API_SECRET` が live と一致（32 文字以上）
- [ ] `LIVE_BASE_URL` / `LIVE_PUBLIC_URL` が正しい（後者未設定だと詳細の URL が空）
- [ ] Task 6 マージ前に本番 live へ `host` 付き PUT をしていない
- [ ] Active Job `:async` のジョブ欠落を許容していることを理解している
- [ ] `master.key` / 各種秘密がリポジトリとログに出ていない

## ユーザーが手で行う初回設定

順番つきの詳細はリポジトリ外の作業メモ（`.scratchpad/task7-user-setup.md`）にもまとめる。概要:

1. Neon（pooled / direct の 2 URL）
2. R2 バケット・https 公開・CORS・API トークン
3. **ローカル開発**で `bin/rails db:encryption:init` → 3 値を Secret へ（production 上では回さない）
4. 作成者ローカルの `config/master.key` を読んで `RAILS_MASTER_KEY` を Secret へ。`ADMIN_API_SECRET`（live と共有）を用意
5. Artifact Registry + Cloud Run サービス（probe = `/up`、サービスの DB は pooled のみ）
6. イメージ push → Secret／環境変数 → Job で migrate（`DATABASE_URL`=direct）→ 初回だけ seed → 動作確認
7. Task 6 マージ後にリハーサル開催回で実 PUT と幹事ログイン

## 注意

- `config/master.key` はコミットしない（`.gitignore` の `/config/*.key`）。
- `DATABASE_URL`・R2 鍵・`ADMIN_API_SECRET`・幹事パスワードをログに出さない（`filter_parameter_logging` あり）。
- **本番のクイズ進行中に live をデプロイしない**（WebSocket が切れる）。admin のデプロイは進行中ゲストには届かないが、開催回作成中の PUT とはぶつかりうるので式次第では控える。
