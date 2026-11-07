class User < ApplicationRecord
  has_secure_password

  enum :role, { system_admin: "system_admin", organizer: "organizer" }, validate: true

  normalizes :email, with: ->(email) { email.strip.downcase }

  validates :email, presence: true, uniqueness: true
end
