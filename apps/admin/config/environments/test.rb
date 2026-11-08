Rails.application.configure do
  config.enable_reloading = false

  config.eager_load = ENV["CI"].present?

  config.public_file_server.headers = { "cache-control" => "public, max-age=3600" }

  config.consider_all_requests_local = true
  config.cache_store = :null_store

  config.action_dispatch.show_exceptions = :rescuable

  config.action_controller.allow_forgery_protection = false

  config.active_storage.service = :test

  config.active_support.deprecation = :stderr

  config.action_controller.raise_on_missing_callback_actions = true

  # Active Record Encryption（QuizSession#host_password）のテスト用の固定鍵。本番は環境変数から読む。
  config.active_record.encryption.primary_key = "test-primary-key-0123456789abcdef"
  config.active_record.encryption.deterministic_key = "test-deterministic-key-0123456789"
  config.active_record.encryption.key_derivation_salt = "test-key-derivation-salt-0123456789"
end
