require "rails_helper"

RSpec.describe "db/seeds" do
  before do
    @original = ENV.to_h.slice("ADMIN_EMAIL", "ADMIN_PASSWORD")
    Question.delete_all
    User.delete_all
  end

  after do
    %w[ADMIN_EMAIL ADMIN_PASSWORD].each { |key| ENV.delete(key) }
    ENV.update(@original)
  end

  def run_seeds
    original_stdout = $stdout
    original_stderr = $stderr
    $stdout = StringIO.new
    $stderr = StringIO.new
    Rails.application.load_seed
    $stdout.string
  ensure
    $stdout = original_stdout
    $stderr = original_stderr
  end

  it "環境変数から最初のシステム管理者を作り、2 回流しても 1 人のまま" do
    ENV["ADMIN_EMAIL"] = "first@example.com"
    ENV["ADMIN_PASSWORD"] = "seed-password-1"

    run_seeds
    run_seeds

    expect(User.system_admin.count).to eq 1
    expect(User.system_admin.first.authenticate("seed-password-1")).to be_truthy
  end

  it "既に管理者がいれば何もしない（パスワードも変えない）" do
    User.create!(email: "existing@example.com", password: "existing-pass", role: "system_admin")
    ENV["ADMIN_EMAIL"] = "other@example.com"
    ENV["ADMIN_PASSWORD"] = "other-pass"

    run_seeds

    expect(User.system_admin.pluck(:email)).to eq %w[existing@example.com]
    expect(User.find_by(email: "existing@example.com").authenticate("existing-pass")).to be_truthy
  end

  it "弱い ADMIN_PASSWORD（12 文字未満）では seed が失敗して管理者を作らない" do
    ENV["ADMIN_EMAIL"] = "weak@example.com"
    ENV["ADMIN_PASSWORD"] = "short-pass"

    expect { run_seeds }.to raise_error(ActiveRecord::RecordInvalid)
    expect(User.count).to eq 0
  end

  it "環境変数が無ければ何も作らずメッセージだけ出す" do
    ENV.delete("ADMIN_EMAIL")
    ENV.delete("ADMIN_PASSWORD")

    out = run_seeds

    expect(User.count).to eq 0
    expect(out).to match(/ADMIN_EMAIL/)
  end
end
