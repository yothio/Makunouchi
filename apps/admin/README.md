# apps/admin（管理画面）

結婚式クイズの管理画面（Rails 8）。システム管理者・主催者が問題と開催回を準備する。当日の進行は `apps/live` が受け持つ。
計画は `docs/superpowers/plans/2026-11-07-admin.md`。

> **admin は Rails のみ。JS パッケージにしない。** ルートの `pnpm-workspace.yaml` は `apps/*` を対象にするが、`apps/admin` に `package.json` を置かない限り無視される。置かないこと。

## 構成

- DB は Neon の PostgreSQL の **primary 1 つだけ**。cache / queue 用の別 DB は持たない。
- キャッシュはメモリ（`:memory_store`）、Active Job は `:async`。`solid_cache` / `solid_queue` は使わない。
- 画像は Cloudflare R2（S3 互換）。本番はブラウザから R2 に直接アップロードする（Active Storage の direct upload）。
- デプロイは Cloud Run。Kamal は使わない。

## 環境変数

| 変数 | 用途 |
|---|---|
| `DATABASE_URL` | アプリ用。本番は Neon の **pooled** 接続用 URL。development は未設定ならローカルの `admin_development` |
| `DATABASE_URL_DIRECT` | マイグレーション用。Neon の **direct** 接続 URL。アプリは読まない（下の「マイグレーション」） |
| `TEST_DATABASE_URL` | test の接続先。未設定ならローカルの `admin_test` |
| `RAILS_MASTER_KEY` | `config/master.key` の値。**コミットしない** |
| `R2_BUCKET` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_ENDPOINT` | R2。**本番の起動に 4 つとも必須**（欠けたら起動で落ちる） |
| `PORT` | 待ち受けポート。Cloud Run が渡す。無いときの既定は本番だけ 8080、開発・テストは 3000（`config/puma.rb`）。開発の CORS の例（`http://localhost:3000`）と一致 |

`ADMIN_API_SECRET`、`LIVE_BASE_URL`、`LIVE_PUBLIC_URL`、`R2_PUBLIC_BASE_URL` などは後続の Task で足す。

## ローカルで動かす

ローカルの Postgres が要る（`PGUSER` / `PGHOST` で接続先を変えられる）。

```
bin/setup --skip-server   # bundle install と db:prepare
bin/rails test
```

## マイグレーション

コンテナの起動時には `db:prepare` を流さない。Neon の pooled 接続（PgBouncer のトランザクションモード）はアドバイザリロックと相性が悪く（Neon の文書もマイグレーションには direct 接続を勧めている。**要確認**）、Cloud Run の複数インスタンスが同時に流すと競合するため。デプロイのたびに direct 接続で 1 回だけ流す（Cloud Run のジョブ、またはデプロイ前の手動手順）:

```
DATABASE_URL="$DATABASE_URL_DIRECT" bin/rails db:migrate
```

## 同時実行の目安

Cloud Run のコンテナ同時リクエスト数（既定 80）に対して、Puma のスレッドは 3、DB の `max_connections` は 5。接続は Neon の pooled が受けるので実害は小さいが、この前提を変えるときは三つを合わせて見直す。

## R2 の設定（コンソール作業）

- **公開 URL** はカスタムドメイン（https）を使う（`r2.dev` は本番向けでない）。live のペイロードの `imageUrl` は https でなければならない。開発の Disk では https の URL が作れないので、画像 URL は `R2_PUBLIC_BASE_URL` が設定されているときだけ出す。
- **CORS**: `AllowedOrigins` は管理画面の本番オリジンだけ、`AllowedMethods` は `PUT`、`AllowedHeaders` は `Content-Type` / `Content-MD5` / `Content-Disposition`、`MaxAgeSeconds` を付ける。Rails 8.1 が direct upload で返すヘッダ（`headers_for_direct_upload`）を実機で確かめてから確定する。開発で実 R2 を試すなら別バケットで `http://localhost:3000` を許可する。
- **aws-sdk-s3**: 1.178 以降の既定のチェックサム（CRC 系）は R2 で失敗することがあるため、`config/storage.yml` で `request_checksum_calculation` / `response_checksum_validation` を `when_required` にしている。Gemfile は `>= 1.178` を下限にしている（`Gemfile.lock` は 1.239.0）。実 R2 で画像の analyze と purge が通ることを確かめる。
- Content-Security-Policy を有効にする場合は、`connect-src` に R2 のエンドポイントを足す（雛形ではコメントアウトで今は効かない）。

## 注意

- `config/master.key` はコミットしない（`.gitignore` の `/config/*.key`）。
- `DATABASE_URL` や R2 の鍵をログに出さない。
