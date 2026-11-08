require "test_helper"

class QuizPayloadBuilderTest < ActiveSupport::TestCase
  def organizer_with(count)
    user = users(:other_organizer)
    user.questions.destroy_all
    count.times do |i|
      user.questions.create!(title: "問題#{i}", choice_a: "a", choice_b: "b", choice_c: "c", choice_d: "d", correct_index: i % 4)
    end
    user
  end

  test "points と topN は無く、host.passwordHash があり平文パスワードはどこにも入らない" do
    session = QuizSession.prepare(user: organizer_with(5), title: "本番").tap(&:save!)

    payload = QuizPayloadBuilder.call(session)

    assert_equal "本番", payload[:title]
    assert_equal 5, payload[:questions].size
    assert_not payload.key?(:points)
    assert_not payload.key?(:topN)
    assert_not payload.key?("points")
    assert_not payload.key?("topN")
    assert_equal session.host_login_id, payload.dig(:host, :loginId)
    assert_equal session.host_password_hash, payload.dig(:host, :passwordHash)
    assert_nil payload.dig(:host, :password)
    assert_nil payload.dig(:host, :host_password)
    dumped = JSON.generate(payload)
    assert_no_match(/#{Regexp.escape(session.host_password)}/, dumped)
  end

  test "画像ありなら imageUrl は R2_PUBLIC_BASE_URL と imageKey から https で組む" do
    user = organizer_with(5)
    question = user.questions.first
    question.image.attach(io: file_fixture("sample.png").open, filename: "sample.png", content_type: "image/png")
    question.save!
    session = QuizSession.prepare(user: user, title: "本番").tap(&:save!)
    original = ENV["R2_PUBLIC_BASE_URL"]
    ENV["R2_PUBLIC_BASE_URL"] = "https://cdn.example.com/quiz"

    payload = QuizPayloadBuilder.call(session)

    assert_equal "https://cdn.example.com/quiz/#{question.image.blob.key}", payload[:questions].first[:imageUrl]
  ensure
    ENV["R2_PUBLIC_BASE_URL"] = original
  end

  test "画像なしなら imageUrl は null" do
    session = QuizSession.prepare(user: organizer_with(5), title: "本番").tap(&:save!)

    payload = QuizPayloadBuilder.call(session)

    assert_nil payload[:questions].first[:imageUrl]
  end

  test "本番で画像 URL が https にならないときは例外" do
    user = organizer_with(5)
    question = user.questions.first
    question.image.attach(io: file_fixture("sample.png").open, filename: "sample.png", content_type: "image/png")
    question.save!
    session = QuizSession.prepare(user: user, title: "本番").tap(&:save!)
    original = ENV["R2_PUBLIC_BASE_URL"]
    ENV["R2_PUBLIC_BASE_URL"] = "http://insecure.example.com"

    assert_raises(QuizPayloadBuilder::InsecureImageUrl) do
      QuizPayloadBuilder.call(session, strict_https: true)
    end
  ensure
    ENV["R2_PUBLIC_BASE_URL"] = original
  end
end
