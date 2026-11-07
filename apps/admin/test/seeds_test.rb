require "test_helper"

class SeedsTest < ActiveSupport::TestCase
  setup do
    @original = ENV.to_h.slice("ADMIN_EMAIL", "ADMIN_PASSWORD")
    User.delete_all
  end

  teardown do
    %w[ADMIN_EMAIL ADMIN_PASSWORD].each { |key| ENV.delete(key) }
    ENV.update(@original)
  end

  def run_seeds
    capture_io { Rails.application.load_seed }
  end

  test "環境変数から最初のシステム管理者を作り、2 回流しても 1 人のまま" do
    ENV["ADMIN_EMAIL"] = "first@example.com"
    ENV["ADMIN_PASSWORD"] = "seed-password-1"

    run_seeds
    run_seeds

    assert_equal 1, User.system_admin.count
    assert User.system_admin.first.authenticate("seed-password-1")
  end

  test "既に管理者がいれば何もしない（パスワードも変えない）" do
    User.create!(email: "existing@example.com", password: "existing-pass", role: "system_admin")
    ENV["ADMIN_EMAIL"] = "other@example.com"
    ENV["ADMIN_PASSWORD"] = "other-pass"

    run_seeds

    assert_equal %w[existing@example.com], User.system_admin.pluck(:email)
    assert User.find_by(email: "existing@example.com").authenticate("existing-pass")
  end

  test "弱い ADMIN_PASSWORD（12 文字未満）では seed が失敗して管理者を作らない" do
    ENV["ADMIN_EMAIL"] = "weak@example.com"
    ENV["ADMIN_PASSWORD"] = "short-pass"

    assert_raises(ActiveRecord::RecordInvalid) { run_seeds }
    assert_equal 0, User.count
  end

  test "環境変数が無ければ何も作らずメッセージだけ出す" do
    ENV.delete("ADMIN_EMAIL")
    ENV.delete("ADMIN_PASSWORD")

    out, = run_seeds

    assert_equal 0, User.count
    assert_match(/ADMIN_EMAIL/, out)
  end
end
