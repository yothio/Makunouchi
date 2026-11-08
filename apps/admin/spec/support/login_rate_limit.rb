RSpec.configure do |config|
  # ログイン試行の回数制限はプロセス内のカウンターなので、example ごとに空にする。
  config.before do
    SessionsController::LOGIN_RATE_LIMIT_STORE.clear if defined?(SessionsController)
  end
end
