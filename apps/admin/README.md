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
| `DATABASE_URL` | 本番は Neon の **pooled** 接続用 URL。development は未設定ならローカルの `admin_development` |
| `TEST_DATABASE_URL` | test の接続先。未設定ならローカルの `admin_test` |
| `RAILS_MASTER_KEY` | `config/master.key` の値。**コミットしない** |
| `PORT` | 待ち受けポート。Cloud Run が渡す。無ければ 8080 |
| `R2_BUCKET` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_ENDPOINT` | R2。本番の起動に `R2_BUCKET` が必須 |

`ADMIN_API_SECRET`、`LIVE_BASE_URL`、`LIVE_PUBLIC_URL`、`R2_PUBLIC_BASE_URL` などは後続の Task で足す。

## ローカルで動かす

ローカルの Postgres が要る（`PGUSER` / `PGHOST` で接続先を変えられる）。

```
bin/setup --skip-server   # bundle install と db:prepare
bin/rails test
```

## R2 の設定（コンソール作業）

- **公開 URL** はカスタムドメイン（https）を使う（`r2.dev` は本番向けでない）。live のペイロードの `imageUrl` は https でなければならない。開発の Disk では https の URL が作れないので、画像 URL は `R2_PUBLIC_BASE_URL` が設定されているときだけ出す。
- **CORS**: `AllowedOrigins` は管理画面の本番オリジンだけ、`AllowedMethods` は `PUT`、`AllowedHeaders` は `Content-Type` / `Content-MD5` / `Content-Disposition`、`MaxAgeSeconds` を付ける。Rails 8.1 が direct upload で返すヘッダ（`headers_for_direct_upload`）を実機で確かめてから確定する。開発で実 R2 を試すなら別バケットで `http://localhost:3000` を許可する。
- **aws-sdk-s3**: 1.178 以降の既定のチェックサム（CRC 系）は R2 で失敗することがあるため、`config/storage.yml` で `request_checksum_calculation` / `response_checksum_validation` を `when_required` にしている。Gemfile は `>= 1.178` を下限にしている（`Gemfile.lock` は 1.239.0）。実 R2 で画像の analyze と purge が通ることを確かめる。
- Content-Security-Policy を有効にする場合は、`connect-src` に R2 のエンドポイントを足す（雛形ではコメントアウトで今は効かない）。

## 注意

- `config/master.key` はコミットしない（`.gitignore` の `/config/*.key`）。
- `DATABASE_URL` や R2 の鍵をログに出さない。
