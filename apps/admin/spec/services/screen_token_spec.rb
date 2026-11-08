require "rails_helper"

RSpec.describe ScreenToken do
  let(:secret) { "0123456789abcdef0123456789abcdef" }

  # HMAC-SHA256(secret, "screen:" + sessionId) の hex。Python の hmac で独立に求めた値
  # （apps/live の screenTokenFor と同じ式）。
  it "固定ベクタと一致する" do
    expect(ScreenToken.screen(secret, "session-1")).to eq "4527ed3abecd1129d21bfff17e2aca6f7dfb727b333132e569c74f8b77b0b464"
  end

  it "開催回 ID が違えばトークンも違う" do
    expect(ScreenToken.screen(secret, "a")).not_to eq ScreenToken.screen(secret, "b")
  end
end
