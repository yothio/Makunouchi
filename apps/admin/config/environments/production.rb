require "active_support/core_ext/integer/time"

Rails.application.configure do
  config.enable_reloading = false

  config.eager_load = true

  config.consider_all_requests_local = false

  config.action_controller.perform_caching = true

  config.public_file_server.headers = { "cache-control" => "public, max-age=#{1.year.to_i}" }

  # 画像は Cloudflare R2（S3 互換）。ブラウザから direct upload（config/storage.yml の r2）。
  config.active_storage.service = :r2

  # Cloud Run が TLS を終端する。
  config.assume_ssl = true

  # SSL 強制（HSTS / Secure cookie）。ログイン cookie と幹事パスワード向け。assume_ssl と併用。
  config.force_ssl = true

  config.ssl_options = { redirect: { exclude: ->(request) { request.path == "/up" } } }

  # 利用者は独自ドメインだけで使う。未設定なら run.app も通常どおり応答する。force_ssl より前に置き、http の run.app も独自ドメインの https へ直接飛ばす。
  if ENV["ADMIN_CANONICAL_HOST"].present?
    require_relative "../../lib/canonical_host_redirect"
    config.middleware.insert_before 0, CanonicalHostRedirect, ENV["ADMIN_CANONICAL_HOST"]
  end

  config.log_tags =[ :request_id ]
  config.logger   = ActiveSupport::TaggedLogging.logger(STDOUT)

  config.log_level = ENV.fetch("RAILS_LOG_LEVEL", "info")

  config.silence_healthcheck_path = "/up"

  config.active_support.report_deprecations = false

  # Active Record Encryption（QuizSession#host_password）。環境変数必須（無ければ起動失敗）。生成: bin/rails db:encryption:init。リポジトリに入れない。
  config.active_record.encryption.primary_key = ENV.fetch("ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY")
  config.active_record.encryption.deterministic_key = ENV.fetch("ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY")
  config.active_record.encryption.key_derivation_salt = ENV.fetch("ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT")

  # キャッシュはメモリ（インスタンス間非共有）。DB は primary のみ。
  config.cache_store = :memory_store

  # 自前ジョブなし。Active Storage の解析・削除だけ同一プロセスで流す。
  config.active_job.queue_adapter = :async

  # i18n フォールバックは application.rb（ja → en）。ここで true にすると [:ja] だけになり翻訳漏れが "Translation missing" になる。

  config.active_record.dump_schema_after_migration = false

  config.active_record.attributes_for_inspect = [ :id ]
end
