require "test_helper"

class UserTest < ActiveSupport::TestCase
  test "password なしでは保存できない" do
    user = User.new(email: "new@example.com", role: "organizer")

    assert_not user.save
    assert user.errors.of_kind?(:password, :blank)
  end

  test "email は必須で、大文字小文字と前後の空白を無視して一意" do
    assert_not User.new(email: "", password: "password12345", role: "organizer").valid?

    user = User.new(email: "  Organizer@Example.com ", password: "password12345", role: "organizer")
    assert_not user.valid?
    assert user.errors.of_kind?(:email, :taken)
  end

  test "role は system_admin か organizer だけ" do
    assert users(:system_admin).system_admin?
    assert users(:organizer).organizer?
    assert_not User.new(email: "x@example.com", password: "password12345", role: "guest").valid?
    assert_not User.new(email: "x@example.com", password: "password12345", role: nil).valid?
  end

  test "パスワードは 12 文字以上（システム管理者も主催者も）" do
    %w[organizer system_admin].each do |role|
      short = User.new(email: "short@example.com", password: "a" * 11, role: role)
      assert_not short.valid?, "#{role} の 11 文字は無効"
      assert short.errors.of_kind?(:password, :too_short)

      assert User.new(email: "ok@example.com", password: "a" * 12, role: role).valid?, "#{role} の 12 文字は有効"
    end
  end

  test "パスワードを触らない更新は最小長の検証に引っかからない" do
    user = users(:organizer)
    user.update!(email: "renamed@example.com")

    assert_equal "renamed@example.com", user.reload.email
  end

  test "email を小文字にそろえて保存する" do
    user = User.create!(email: "  MiXed@Example.COM ", password: "password12345", role: "organizer")

    assert_equal "mixed@example.com", user.reload.email
  end

  test "パスワードは平文で保存されず、authenticate_by で照合できる" do
    user = users(:organizer)

    assert_not_equal "password12345", user.password_digest
    assert_equal user, User.authenticate_by(email: user.email, password: "password12345")
    assert_nil User.authenticate_by(email: user.email, password: "wrong")
  end
end
