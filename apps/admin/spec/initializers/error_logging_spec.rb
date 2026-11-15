require "rails_helper"

RSpec.describe ErrorLogSubscriber do
  it "Rails.error に報告された例外をクラス・メッセージ・バックトレース付きで error に出す" do
    allow(Rails.logger).to receive(:error)
    error = RuntimeError.new("boom")
    error.set_backtrace([ "app/models/a.rb:1:in 'foo'" ])

    Rails.error.report(error, handled: false, severity: :error, source: "spec")

    expect(Rails.logger).to have_received(:error).with(
      "[Rails.error] RuntimeError: boom (handled=false source=spec)\napp/models/a.rb:1:in 'foo'"
    )
  end

  it "warning で報告されたものは warn に出す" do
    allow(Rails.logger).to receive(:warn)

    Rails.error.handle(severity: :warning) { raise ArgumentError, "x" }

    expect(Rails.logger).to have_received(:warn).with(a_string_starting_with("[Rails.error] ArgumentError: x (handled=true"))
  end

  it "context は出さない" do
    allow(Rails.logger).to receive(:error)

    Rails.error.report(RuntimeError.new("boom"), severity: :error, context: { host_password: "秘密" })

    expect(Rails.logger).to have_received(:error).with(satisfy { |message| !message.include?("秘密") })
  end
end
