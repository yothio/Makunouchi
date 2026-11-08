# admin（管理画面）

結婚式クイズの管理画面（Rails 8.1）です。システム管理者・主催者が問題と開催回を準備し、幹事 ID/PASS を発行して live に登録します。当日の進行は [`apps/live`](../live/README.md) が受け持ちます。結果の取り込み・保存はせず、`ranking` API も呼びません。

デプロイ（Cloud Run、Workload Identity、R2、CI）は [docs/deploy/admin.md](../../docs/deploy/admin.md) です。

> **admin は Rails のみ。JS パッケージにしない。** ルートの `pnpm-workspace.yaml` は `apps/*` を対象にするが、`apps/admin` に `package.json` を置かない限り無視される。置かないこと。

## 構成

- DB は Neon の PostgreSQL の **primary 1 つだけ**。cache / queue 用の別 DB は持たない
- キャッシュはメモリ（`:memory_store`）、Active Job は `:async`。`solid_cache` / `solid_queue` は使わない
- 画像は Cloudflare R2（S3 互換）。本番はブラウザから R2 に直接アップロードする（Active Storage の direct upload）
- デプロイは Cloud Run。Kamal は使わない
- 待ち受けは `PORT`（Cloud Run が渡す。無いときの本番既定は 8080）。health は `/up`
- Ruby は `.ruby-version`（4.0.6）

## 環境変数

秘密はすべて環境変数（または Secret Manager）で渡し、**リポジトリにコミットしない**。

| 変数 | 必須 | 用途 |
|---|---|---|
| `DATABASE_URL` | 本番必須 | アプリ用。Neon の **pooled** 接続 URL。Cloud Run **サービス**側にはこれだけ（direct は載せない） |
| `DATABASE_URL_DIRECT` | マイグレーション時 | Neon の **direct** 接続 URL。アプリ起動では読まない。migrate/seed 用 Job（または手元）で `DATABASE_URL` に差し替えて使う |
| `TEST_DATABASE_URL` | テスト推奨 | test の接続先。未設定ならローカルの `admin_test` |
| `RAILS_MASTER_KEY` | 本番必須 | `credentials.yml.enc` 解読用。リポジトリには入れない。**作成者のローカル** `apps/admin/config/master.key` を手元で読み、Secret Manager に一度だけ保存する。クローンしただけではファイルは無い。失うと credentials の再発行が必要 |
| `ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY` / `ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY` / `ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT` | 本番必須 | 幹事パスワード暗号化。**ローカル開発**で `bin/rails db:encryption:init` を実行し、表示された 3 値を本番 Secret へ移す（production イメージ上では回さない）。失うと既存開催回の PASS が読めない |
| `R2_BUCKET` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_ENDPOINT` | 本番必須 | R2。欠けたら起動で落ちる |
| `R2_PUBLIC_BASE_URL` | 画像付き開催回 | 公開 https のベース（`{base}/{blob.key}`）。カスタムドメイン。`r2.dev` は本番向けでない |
| `ADMIN_API_SECRET` | live 連携必須 | live Worker と同じ値（本番は 32 文字以上）。PUT `/api/sessions/:id` の Bearer |
| `LIVE_BASE_URL` | live 連携必須 | Rails → Worker の API ベース |
| `LIVE_PUBLIC_URL` | 本番で画面を使うなら必須 | 開催回詳細の参列者・幹事 URL の元。未設定だと URL が空（先頭が欠けたパス）になり、画面からコピーできない |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | 初回 seed | システム管理者 1 人。`ADMIN_PASSWORD` は **12 文字以上**。既に管理者がいれば seed は何もしない |
| `ADMIN_CANONICAL_HOST` | 任意（本番で独自ドメインを使うなら設定） | 管理画面の独自ドメインのホスト名だけ（`https://` やパスは付けない）。設定すると、Host が `*.run.app` のリクエストは `/up` 以外を独自ドメインへ 302（GET / HEAD）または 403（それ以外）にする。未設定なら何もしない。値が不正なら起動で落ちる。手順は [docs/deploy/admin.md](../../docs/deploy/admin.md) の「Cloud Run の既定ドメインと独自ドメイン」 |
| `PORT` | Cloud Run が渡す | 待ち受け。無いときの既定は本番 8080、開発・テスト 3000 |
| `RAILS_LOG_LEVEL` | 任意 | 既定 `info` |
| `RAILS_MAX_THREADS` | 任意 | Puma スレッド（既定 3） |

## ローカルで動かす

開発・テストの Active Record Encryption の鍵は `config/environments/{development,test}.rb` に捨ての固定値で入れてある（本番の鍵とは無関係）。

ローカルの Postgres が要る（`DATABASE_URL` / `TEST_DATABASE_URL`、または `PGUSER` / `PGHOST` など）。

```
bin/setup --skip-server
bundle exec rspec
bin/rails server
bin/rubocop
```

- `bin/setup --skip-server`: bundle install と db:prepare
- `bin/rails server`: <http://localhost:3000>
- `bin/rubocop`: 直せるものは `bin/rubocop -a`。CI は `admin-lint`
- テストは RSpec（`spec/`）。1 ファイルだけなら `bundle exec rspec spec/models/user_spec.rb`
- テストデータは fixtures でなく factory_bot（`spec/factories/`）。`create(:user)`、`create(:user, :system_admin)` のように trait で状態を選ぶ。`spec/factories_spec.rb` が factory を検証する。添付ファイルの素材だけ `spec/fixtures/files/` に置く

初回だけシステム管理者を作る例です（パスワードは 12 文字以上）。

```
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='your-long-password' bin/rails db:seed
```

### よくあるつまずき

- `bin/setup` や rspec が DB で落ちる → ローカル Postgres と `DATABASE_URL` / `TEST_DATABASE_URL` を確認する
- 画像 upload がローカルで失敗する → 開発用のストレージ設定と、必要なら開発用 R2／ディスクを確認する
- live への開催回登録が失敗する → `LIVE_BASE_URL` と `ADMIN_API_SECRET`（live と同じ値）を確認する

## マイグレーション

コンテナの起動時には `db:prepare` / `db:migrate` を流さない。Neon の pooled 接続（PgBouncer のトランザクションモード）はアドバイザリロックと相性が悪く、Cloud Run の複数インスタンスが同時に流すと競合するため。デプロイのたびに direct 接続で **1 回だけ** 流す（Cloud Run Jobs、またはデプロイ前の手動）。手順は [docs/deploy/admin.md](../../docs/deploy/admin.md) を見てください。

手元で direct に差し替える例です。

```
DATABASE_URL="<direct の URL>" bin/rails db:migrate
```

環境変数はアプリと同じものを渡し（`RAILS_MASTER_KEY`・`R2_*`・Active Record Encryption の 3 つを含む。本番では `storage.yml` が起動時に読まれ、欠けると `KeyError`）、`DATABASE_URL` だけを direct にする。

## live との結合

- `ADMIN_API_SECRET` は live（`wrangler secret`）と **同じ値**
- Rails は `LIVE_BASE_URL` へ `PUT /api/sessions/:id`（Bearer）するだけ。`ranking` は呼ばない
- 幹事 ID/PASS は開催回作成時に `host` として live へ送る。live 側が受け取る実装と揃っていないと、幹事認証が DO に残らない
- 投影 URL（`/screen/...`）は live の screen トークン付き

## ログインとセッション

- セッションは暗号化 cookie。有効期限は**最後に使ってから 8 時間**（使うたびに延びる）。cookie は HTTPS 限定・HttpOnly
- **ログアウト**でそのユーザーの `users.sessions_valid_after` が更新され、それより前の全セッションが無効になる
- ログイン試行は IP・メールごとに 3 分 10 回（超えたら 429）。回数はインスタンスごと
- パスワード再設定機能は無い。忘れたときは管理者が DB で直す

## Active Job（`:async`）について

ジョブは同一プロセス内で動く。Cloud Run のインスタンスが止まった瞬間に未完了ジョブは失われる。自前のジョブは無く、Active Storage の解析・削除程度なので、MVP ではこの欠落を許容する。重要な処理をジョブに載せるなら別アダプタが要る。

## デプロイ

初回設定、Cloud Run、R2 CORS、Workload Identity、release タグ（`app-YYYYMMDD-HHMM`）経由のデプロイ、本番前チェックリストは [docs/deploy/admin.md](../../docs/deploy/admin.md) にまとめています。


## 注意

- `config/master.key` はコミットしない（`.gitignore` の `/config/*.key`）
- `DATABASE_URL`・R2 鍵・`ADMIN_API_SECRET`・幹事パスワードをログに出さない（`filter_parameter_logging` あり）
- **本番のクイズ進行中に live をデプロイしない**（WebSocket が切れる）。admin のデプロイは進行中ゲストには届かないが、開催回作成中の PUT とはぶつかりうるので式次第では控える
