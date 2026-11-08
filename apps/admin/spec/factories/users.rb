FactoryBot.define do
  factory :user do
    sequence(:email) { |n| "user#{n}@example.com" }
    password { SignInHelper::PASSWORD }
    role { "organizer" }

    trait :system_admin do
      role { "system_admin" }
    end
  end
end
