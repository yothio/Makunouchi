FactoryBot.define do
  # 開催回は QuizSession.prepare で作るのが本来の経路。ここでは問題一式に依らない最小の 5 問のスナップショットと、
  # 幹事の認証情報を直接組み立てる（prepare そのものを確かめる spec は prepare を呼ぶ）。
  factory :quiz_session do
    transient do
      credentials { HostCredentials.generate }
    end

    user
    sequence(:title) { |n| "開催回#{n}" }
    status { "pending" }
    public_id { SecureRandom.uuid }
    quiz_snapshot do
      Array.new(QuizSession::QUESTION_COUNT.min) do |i|
        { "title" => "問題#{i}", "choices" => %w[a b c d], "correctIndex" => i % 4, "imageKey" => nil }
      end
    end
    host_login_id { credentials[:login_id] }
    host_password { credentials[:password] }
    host_password_hash { credentials[:password_hash] }

    trait :ready do
      status { "ready" }
    end

    trait :host_missing do
      status { "host_missing" }
    end
  end
end
