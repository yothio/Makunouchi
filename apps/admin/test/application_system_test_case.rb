require "test_helper"

class ApplicationSystemTestCase < ActionDispatch::SystemTestCase
  # JS は不要な Happy Path なので rack_test（ブラウザ不要）。
  driven_by :rack_test
end
