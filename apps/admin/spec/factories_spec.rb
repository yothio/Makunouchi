require "rails_helper"

# factory 自体が壊れていない（モデルの検証を通る）ことを、trait も含めて確かめる。
RSpec.describe "factories" do
  it "すべての factory と trait が有効" do
    FactoryBot.lint traits: true
  end
end
