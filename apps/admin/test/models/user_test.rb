require "test_helper"

class UserTest < ActiveSupport::TestCase
  test "password なしでは保存できない" do
    user = User.new(email: "new@example.com", role: "organizer")

    assert_not user.save
    assert user.errors.of_kind?(:password, :blank)
  end

  test "email は必須で、大文字小文字と前後の空白を無視して一意" do
    assert_not User.new(email: "", password: "password123", role: "organizer").valid?

    user = User.new(email: "  Organizer@Example.com ", password: "password123", role: "organizer")
    assert_not user.valid?
    assert user.errors.of_kind?(:email, :taken)
  end

  test "role は system_admin か organizer だけ" do
    assert users(:system_admin).system_admin?
    assert users(:organizer).organizer?
    assert_not User.new(email: "x@example.com", password: "password123", role: "guest").valid?
    assert_not User.new(email: "x@example.com", password: "password123", role: nil).valid?
  end

  test "email を小文字にそろえて保存する" do
    user = User.create!(email: "  MiXed@Example.COM ", password: "password123", role: "organizer")

    assert_equal "mixed@example.com", user.reload.email
  end

  test "パスワードは平文で保存されず、authenticate_by で照合できる" do
    user = users(:organizer)

    assert_not_equal "password123", user.password_digest
    assert_equal user, User.authenticate_by(email: user.email, password: "password123")
    assert_nil User.authenticate_by(email: user.email, password: "wrong")
  end
end
