require "rails_helper"

RSpec.describe "factories" do
  it "すべての factory と trait が有効" do
    FactoryBot.lint traits: true
  end
end
