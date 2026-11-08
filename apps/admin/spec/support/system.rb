RSpec.configure do |config|
  # system spec は JS を使わないので rack_test にする。
  config.before(:each, type: :system) do
    driven_by :rack_test
  end
end
