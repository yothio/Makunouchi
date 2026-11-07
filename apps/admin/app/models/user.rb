class User < ApplicationRecord
  has_secure_password

  enum :role, { system_admin: "system_admin", organizer: "organizer" }, validate: true

  normalizes :email, with: ->(email) { email.strip.downcase }

  validates :email, presence: true, uniqueness: true
  # 最小 12 文字（システム管理者も主催者も。ユーザー決定 2026-11-07）。更新でパスワードを触らないときは検証しない。
  validates :password, length: { minimum: 12 }, allow_nil: true
end
