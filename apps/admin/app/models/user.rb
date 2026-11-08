class User < ApplicationRecord
  has_secure_password

  has_many :questions, -> { order(:id) }, dependent: :destroy
  has_many :quiz_sessions, -> { order(:id) }, dependent: :destroy

  enum :role, { system_admin: "system_admin", organizer: "organizer" }, validate: true

  normalizes :email, with: ->(email) { email.strip.downcase }

  validates :email, presence: true, uniqueness: true
  # パスワードは最小 12 文字。更新で password を送らないときは検証しない。
  validates :password, length: { minimum: 12 }, allow_nil: true
end
