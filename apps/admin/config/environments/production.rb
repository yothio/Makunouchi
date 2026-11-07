require "active_support/core_ext/integer/time"

Rails.application.configure do
  # Settings specified here will take precedence over those in config/application.rb.

  # Code is not reloaded between requests.
  config.enable_reloading = false

  # Eager load code on boot for better performance and memory savings (ignored by Rake tasks).
  config.eager_load = true

  # Full error reports are disabled.
  config.consider_all_requests_local = false

  # Turn on fragment caching in view templates.
  config.action_controller.perform_caching = true

  # Cache assets for far-future expiry since they are all digest stamped.
  config.public_file_server.headers = { "cache-control" => "public, max-age=#{1.year.to_i}" }

  # Enable serving of images, stylesheets, and JavaScripts from an asset server.
  # config.asset_host = "http://assets.example.com"

  # 画像は Cloudflare R2（S3 互換）に置く。ブラウザから direct upload する（config/storage.yml の r2）。
  config.active_storage.service = :r2

  # Assume all access to the app is happening through a SSL-terminating reverse proxy.
  # Cloud Run が TLS を終端する。
  config.assume_ssl = true

  # SSL を強制し、HSTS と Secure cookie を付ける（ログイン cookie と幹事パスワードを扱う）。assume_ssl と併用する。
  config.force_ssl = true

  # Skip http-to-https redirect for the default health check endpoint.
  config.ssl_options = { redirect: { exclude: ->(request) { request.path == "/up" } } }

  # Log to STDOUT with the current request id as a default log tag.
  config.log_tags = [ :request_id ]
  config.logger   = ActiveSupport::TaggedLogging.logger(STDOUT)

  # Change to "debug" to log everything (including potentially personally-identifiable information!).
  config.log_level = ENV.fetch("RAILS_LOG_LEVEL", "info")

  # Prevent health checks from clogging up the logs.
  config.silence_healthcheck_path = "/up"

  # Don't log any deprecations.
  config.active_support.report_deprecations = false

  # キャッシュはメモリ（インスタンス間で共有しない）。DB は primary の 1 つだけ。
  config.cache_store = :memory_store

  # 自前のジョブは無い。Active Storage の解析・削除ジョブだけを同一プロセスで流す。
  config.active_job.queue_adapter = :async

  # i18n のフォールバックは config/application.rb（ja → en）で決める。ここで true にすると
  # [:ja] だけに上書きされ、翻訳漏れが "Translation missing" になる。

  # Do not dump schema after migrations.
  config.active_record.dump_schema_after_migration = false

  # Only use :id for inspections in production.
  config.active_record.attributes_for_inspect = [ :id ]

  # Enable DNS rebinding protection and other `Host` header attacks.
  # config.hosts = [
  #   "example.com",     # Allow requests from example.com
  #   /.*\.example\.com/ # Allow requests from subdomains like `www.example.com`
  # ]
  #
  # Skip DNS rebinding protection for the default health check endpoint.
  # config.host_authorization = { exclude: ->(request) { request.path == "/up" } }
end
