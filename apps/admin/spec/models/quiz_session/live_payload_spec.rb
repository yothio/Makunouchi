require "rails_helper"

RSpec.describe QuizPayloadBuilder do
  def organizer_with(count)
    create(:user).tap { |user| create_list(:question, count, user: user) }
  end

  it "points と topN は無く、host.passwordHash があり平文パスワードはどこにも入らない" do
    session = QuizSession.prepare(user: organizer_with(5), title: "本番").tap(&:save!)

    payload = QuizPayloadBuilder.call(session)

    expect(payload[:title]).to eq "本番"
    expect(payload[:questions].size).to eq 5
    expect(payload.key?(:points)).to be false
    expect(payload.key?(:topN)).to be false
    expect(payload.key?("points")).to be false
    expect(payload.key?("topN")).to be false
    expect(payload.dig(:host, :loginId)).to eq session.host_login_id
    expect(payload.dig(:host, :passwordHash)).to eq session.host_password_hash
    expect(payload.dig(:host, :password)).to be_nil
    expect(payload.dig(:host, :host_password)).to be_nil
    dumped = JSON.generate(payload)
    expect(dumped).not_to match(/#{Regexp.escape(session.host_password)}/)
  end

  it "画像ありなら imageUrl は R2_PUBLIC_BASE_URL と imageKey から https で組む" do
    user = organizer_with(5)
    question = user.questions.first
    question.image.attach(io: file_fixture("sample.png").open, filename: "sample.png", content_type: "image/png")
    question.save!
    session = QuizSession.prepare(user: user, title: "本番").tap(&:save!)
    original = ENV["R2_PUBLIC_BASE_URL"]
    ENV["R2_PUBLIC_BASE_URL"] = "https://cdn.example.com/quiz"

    payload = QuizPayloadBuilder.call(session)

    expect(payload[:questions].first[:imageUrl]).to eq "https://cdn.example.com/quiz/#{question.image.blob.key}"
  ensure
    ENV["R2_PUBLIC_BASE_URL"] = original
  end

  it "画像なしなら imageUrl は null" do
    session = QuizSession.prepare(user: organizer_with(5), title: "本番").tap(&:save!)

    payload = QuizPayloadBuilder.call(session)

    expect(payload[:questions].first[:imageUrl]).to be_nil
  end

  it "本番で画像 URL が https にならないときは例外" do
    user = organizer_with(5)
    question = user.questions.first
    question.image.attach(io: file_fixture("sample.png").open, filename: "sample.png", content_type: "image/png")
    question.save!
    session = QuizSession.prepare(user: user, title: "本番").tap(&:save!)
    original = ENV["R2_PUBLIC_BASE_URL"]
    ENV["R2_PUBLIC_BASE_URL"] = "http://insecure.example.com"

    expect {
      QuizPayloadBuilder.call(session, strict_https: true)
    }.to raise_error(QuizPayloadBuilder::InsecureImageUrl)
  ensure
    ENV["R2_PUBLIC_BASE_URL"] = original
  end
end
