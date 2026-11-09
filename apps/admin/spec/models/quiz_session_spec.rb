require "rails_helper"

RSpec.describe QuizSession, type: :model do
  include ActiveJob::TestHelper

  def organizer_with(count)
    create(:user).tap { |user| create_list(:question, count, user: user) }
  end

  it "作成すると pending で、UUID の public_id と幹事 ID/PASS が付く" do
    session = QuizSession.prepare(user: organizer_with(5), title: "本番")
    session.save!

    expect(session).to be_pending
    expect(session.public_id).to match(/\A[A-Za-z0-9_-]{1,100}\z/)
    expect(session.public_id).to match(/\A\h{8}-\h{4}-\h{4}-\h{4}-\h{12}\z/)
    expect(session.host_login_id).to match(/\A[a-z2-9]{8}\z/)
    expect(session.host_password).to match(/\A[a-z2-9]{12}\z/)
    expect(session.host_password_hash).to match(/\Apbkdf2-sha256\$100000\$/)
  end

  it "ハッシュは平文パスワードから作られたもの" do
    session = QuizSession.prepare(user: organizer_with(5), title: "本番")
    salt = Base64.strict_decode64(session.host_password_hash.split("$")[2])

    expect(HostCredentials.hash_password(session.host_password, salt: salt)).to eq session.host_password_hash
  end

  it "問題が 4 問では作れない" do
    session = QuizSession.prepare(user: organizer_with(4), title: "本番")

    expect(session).not_to be_valid
    expect(session.errors[:base].join).to match(/5〜15/)
  end

  it "問題が 5〜15 問なら作れる。16 問では作れない" do
    [ 5, 15 ].each do |n|
      expect(QuizSession.prepare(user: organizer_with(n), title: "本番")).to be_valid, "#{n} 問"
    end
    expect(QuizSession.prepare(user: organizer_with(16), title: "本番")).not_to be_valid
  end

  it "title は 1〜100 文字で、空白だけは無効" do
    user = organizer_with(5)

    expect(QuizSession.prepare(user: user, title: "")).not_to be_valid
    expect(QuizSession.prepare(user: user, title: "   ")).not_to be_valid
    expect(QuizSession.prepare(user: user, title: "あ" * 101)).not_to be_valid
    expect(QuizSession.prepare(user: user, title: "あ" * 100)).to be_valid
  end

  it "スナップショットは作成時の問題一式を出題順に持ち、あとで問題を直しても変わらない" do
    user = organizer_with(5)
    session = QuizSession.prepare(user: user, title: "本番")
    session.save!
    first = user.questions.first

    expect(session.quiz_snapshot.size).to eq 5
    expect(session.quiz_snapshot.first).to eq({ "title" => "問題0", "choices" => %w[a b c d], "correctIndex" => 0, "imageKey" => nil })

    first.update!(title: "書き換えた")
    user.questions.last.destroy!

    expect(session.reload.quiz_snapshot.first["title"]).to eq "問題0"
    expect(session.quiz_snapshot.size).to eq 5
  end

  it "画像つきの問題は blob の key をスナップショットに持つ" do
    user = organizer_with(5)
    question = user.questions.first
    question.image.attach(io: file_fixture("sample.png").open, filename: "sample.png", content_type: "image/png")
    question.save!

    session = QuizSession.prepare(user: user, title: "本番")

    expect(session.quiz_snapshot.first["imageKey"]).to eq question.image.blob.key
  end

  it "派生画像があるときはその key をスナップショットに持つ" do
    user = organizer_with(5)
    question = user.questions.first
    question.image.attach(io: file_fixture("sample.png").open, filename: "sample.png", content_type: "image/png")
    question.save!
    perform_enqueued_jobs only: GenerateDeliveryImageJob
    question.reload

    session = QuizSession.prepare(user: user, title: "本番")

    expect(session.quiz_snapshot.first["imageKey"]).to eq question.delivery_image.blob.key
  end

  it "host_password は DB 上で暗号文になっている" do
    session = QuizSession.prepare(user: organizer_with(5), title: "本番")
    session.save!

    raw = QuizSession.connection.select_value("SELECT host_password FROM quiz_sessions WHERE id = #{session.id}")

    expect(raw).not_to eq session.host_password
    expect(raw).not_to match(/#{Regexp.escape(session.host_password)}/)
    expect(session.reload.host_password).to eq session.host_password
  end

  it "作成後に変えられない項目（public_id・スナップショット・ハッシュ）" do
    session = QuizSession.prepare(user: organizer_with(5), title: "本番")
    session.save!

    expect { session.update!(public_id: "other") }.to raise_error(ActiveRecord::ReadonlyAttributeError)
    expect { session.update!(quiz_snapshot: []) }.to raise_error(ActiveRecord::ReadonlyAttributeError)
    expect { session.update!(host_password_hash: "x") }.to raise_error(ActiveRecord::ReadonlyAttributeError)
  end

  it "status は pending / ready / host_missing だけ" do
    session = QuizSession.prepare(user: organizer_with(5), title: "本番")

    %w[pending ready host_missing].each do |status|
      session.status = status
      expect(session).to be_valid, status
    end
    session.status = "other"
    expect(session).not_to be_valid
  end

  it "参列者・幹事の URL は LIVE_PUBLIC_URL と public_id から作る（トークンなし）" do
    session = QuizSession.prepare(user: organizer_with(5), title: "本番")
    original = ENV["LIVE_PUBLIC_URL"]
    ENV["LIVE_PUBLIC_URL"] = "https://live.example.com/"

    expect(session.guest_url).to eq "https://live.example.com/s/#{session.public_id}"
    expect(session.host_url).to eq "https://live.example.com/host/#{session.public_id}"
  ensure
    ENV["LIVE_PUBLIC_URL"] = original
  end

  it "投影画面の URL は screen トークン付き。ADMIN_API_SECRET が無ければ nil" do
    session = QuizSession.prepare(user: organizer_with(5), title: "本番")
    original_url = ENV["LIVE_PUBLIC_URL"]
    original_secret = ENV["ADMIN_API_SECRET"]
    ENV["LIVE_PUBLIC_URL"] = "https://live.example.com/"
    ENV["ADMIN_API_SECRET"] = "s" * 32

    token = ScreenToken.screen("s" * 32, session.public_id)
    expect(session.screen_url).to eq "https://live.example.com/screen/#{session.public_id}?token=#{token}"
    expect(session.screen_url).not_to match(/#{"s" * 32}/)

    ENV.delete("ADMIN_API_SECRET")
    expect(session.screen_url).to be_nil
  ensure
    ENV["LIVE_PUBLIC_URL"] = original_url
    ENV["ADMIN_API_SECRET"] = original_secret
  end
end
