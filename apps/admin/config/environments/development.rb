require "active_support/core_ext/integer/time"

Rails.application.configure do
  config.enable_reloading = true

  config.eager_load = false

  config.consider_all_requests_local = true

  config.server_timing = true

  if Rails.root.join("tmp/caching-dev.txt").exist?
    config.action_controller.perform_caching = true
    config.action_controller.enable_fragment_cache_logging = true
    config.public_file_server.headers = { "cache-control" => "public, max-age=#{2.days.to_i}" }
  else
    config.action_controller.perform_caching = false
  end

  config.cache_store = :memory_store

  config.active_storage.service = :local

  config.active_support.deprecation = :log

  config.active_record.migration_error = :page_load

  config.active_record.verbose_query_logs = true

  config.active_record.query_log_tags_enabled = true

  config.active_job.verbose_enqueue_logs = true

  config.action_dispatch.verbose_redirect_logs = true

  config.assets.quiet = true

  config.action_view.annotate_rendered_view_with_filenames = true

  config.action_controller.raise_on_missing_callback_actions = true

  config.i18n.raise_on_missing_translations = true

  # Active Record Encryption（QuizSession#host_password）の開発用の固定鍵。捨ての値で、本番の鍵とは無関係
  # （本番は環境変数から必須で読む）。無いと開発で開催回を作ったときに落ちる。
  config.active_record.encryption.primary_key = "dev-primary-key-0123456789abcdef"
  config.active_record.encryption.deterministic_key = "dev-deterministic-key-0123456789"
  config.active_record.encryption.key_derivation_salt = "dev-key-derivation-salt-0123456789"
end
