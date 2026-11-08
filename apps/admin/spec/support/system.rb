RSpec.configure do |config|
  # JS は不要な Happy Path なので rack_test（ブラウザ不要）。
  config.before(:each, type: :system) do
    driven_by :rack_test
  end
end
