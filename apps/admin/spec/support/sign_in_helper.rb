module SignInHelper
  PASSWORD = "password12345".freeze

  def sign_in_as(user)
    post session_path, params: { email: user.email, password: PASSWORD }
  end
end

RSpec.configure do |config|
  config.include SignInHelper, type: :request
end
