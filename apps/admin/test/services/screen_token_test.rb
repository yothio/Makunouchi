require "test_helper"

class ScreenTokenTest < ActiveSupport::TestCase
  SECRET = "0123456789abcdef0123456789abcdef".freeze

  # HMAC-SHA256(secret, "screen:" + sessionId) の hex。Python の hmac で独立に求めた値
  # （apps/live の screenTokenFor と同じ式）。
  test "固定ベクタと一致する" do
    assert_equal "4527ed3abecd1129d21bfff17e2aca6f7dfb727b333132e569c74f8b77b0b464", ScreenToken.screen(SECRET, "session-1")
  end

  test "開催回 ID が違えばトークンも違う" do
    assert_not_equal ScreenToken.screen(SECRET, "a"), ScreenToken.screen(SECRET, "b")
  end
end
