FactoryBot.define do
  # factory は prepare を通さず snapshot と幹事資格を直組み（高速・細かい状態用）。
  factory :quiz_session do
    transient do
      credentials { HostCredentials.generate }
    end

    user
    sequence(:title) { |n| "開催回#{n}" }
    status { "pending" }
    public_id { SecureRandom.uuid }
    quiz_snapshot do
      QuizSession.snapshot_of(build_list(:question, QuizSession::QUESTION_COUNT.min, user: user))
    end
    host_login_id { credentials[:login_id] }
    host_password { credentials[:password] }
    host_password_hash { credentials[:password_hash] }

    trait :host_missing do
      status { "host_missing" }
    end
  end
end
