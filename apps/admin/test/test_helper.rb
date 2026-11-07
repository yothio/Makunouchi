ENV["RAILS_ENV"] ||= "test"
require_relative "../config/environment"
require "rails/test_help"

module SignInHelper
  PASSWORD = "password12345".freeze

  def sign_in_as(user)
    post session_path, params: { email: user.email, password: PASSWORD }
  end
end

module ActiveSupport
  class TestCase
    # Run tests in parallel with specified workers
    parallelize(workers: :number_of_processors)

    # Setup all fixtures in test/fixtures/*.yml for all tests in alphabetical order.
    fixtures :all

    # Add more helper methods to be used by all tests here...
    # ログイン試行の回数制限はプロセス内のカウンターなので、テストごとに空にする。
    setup { SessionsController::LOGIN_RATE_LIMIT_STORE.clear }
  end
end

module ActionDispatch
  class IntegrationTest
    include SignInHelper
  end
end
