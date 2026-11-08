require "rails_helper"

RSpec.describe User, type: :model do
  it "password なしでは保存できない" do
    user = User.new(email: "new@example.com", role: "organizer")

    expect(user.save).to be false
    expect(user.errors.of_kind?(:password, :blank)).to be true
  end

  it "email は必須で、大文字小文字と前後の空白を無視して一意" do
    expect(User.new(email: "", password: "password12345", role: "organizer")).not_to be_valid

    user = User.new(email: "  Organizer@Example.com ", password: "password12345", role: "organizer")
    expect(user).not_to be_valid
    expect(user.errors.of_kind?(:email, :taken)).to be true
  end

  it "role は system_admin か organizer だけ" do
    expect(users(:system_admin)).to be_system_admin
    expect(users(:organizer)).to be_organizer
    expect(User.new(email: "x@example.com", password: "password12345", role: "guest")).not_to be_valid
    expect(User.new(email: "x@example.com", password: "password12345", role: nil)).not_to be_valid
  end

  it "パスワードは 12 文字以上（システム管理者も主催者も）" do
    %w[organizer system_admin].each do |role|
      short = User.new(email: "short@example.com", password: "a" * 11, role: role)
      expect(short).not_to be_valid, "#{role} の 11 文字は無効"
      expect(short.errors.of_kind?(:password, :too_short)).to be true

      expect(User.new(email: "ok@example.com", password: "a" * 12, role: role)).to be_valid, "#{role} の 12 文字は有効"
    end
  end

  it "パスワードを触らない更新は最小長の検証に引っかからない" do
    user = users(:organizer)
    user.update!(email: "renamed@example.com")

    expect(user.reload.email).to eq "renamed@example.com"
  end

  it "email を小文字にそろえて保存する" do
    user = User.create!(email: "  MiXed@Example.COM ", password: "password12345", role: "organizer")

    expect(user.reload.email).to eq "mixed@example.com"
  end

  it "パスワードは平文で保存されず、authenticate_by で照合できる" do
    user = users(:organizer)

    expect(user.password_digest).not_to eq "password12345"
    expect(User.authenticate_by(email: user.email, password: "password12345")).to eq user
    expect(User.authenticate_by(email: user.email, password: "wrong")).to be_nil
  end
end
