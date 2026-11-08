FactoryBot.define do
  # 開催回は QuizSession.prepare で作るのが本来の経路。ここでは prepare と同じ変換（snapshot_of）を
  # 未保存の問題に通してスナップショットを作り、幹事の認証情報は直接組み立てる。
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
