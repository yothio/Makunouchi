require "test_helper"

class QuizSessionTest < ActiveSupport::TestCase
  def organizer_with(count)
    user = users(:other_organizer)
    user.questions.destroy_all
    count.times do |i|
      user.questions.create!(title: "問題#{i}", choice_a: "a", choice_b: "b", choice_c: "c", choice_d: "d", correct_index: i % 4)
    end
    user
  end

  test "作成すると pending で、UUID の public_id と幹事 ID/PASS が付く" do
    session = QuizSession.prepare(user: organizer_with(5), title: "本番")
    session.save!

    assert session.pending?
    assert_match(/\A[A-Za-z0-9_-]{1,100}\z/, session.public_id)
    assert_match(/\A\h{8}-\h{4}-\h{4}-\h{4}-\h{12}\z/, session.public_id)
    assert_match(/\A[a-z2-9]{8}\z/, session.host_login_id)
    assert_match(/\A[a-z2-9]{12}\z/, session.host_password)
    assert_match(/\Apbkdf2-sha256\$100000\$/, session.host_password_hash)
  end

  test "ハッシュは平文パスワードから作られたもの" do
    session = QuizSession.prepare(user: organizer_with(5), title: "本番")
    salt = Base64.strict_decode64(session.host_password_hash.split("$")[2])

    assert_equal session.host_password_hash, HostCredentials.hash_password(session.host_password, salt: salt)
  end

  test "問題が 4 問では作れない" do
    session = QuizSession.prepare(user: organizer_with(4), title: "本番")

    assert_not session.valid?
    assert_match(/5〜15/, session.errors[:base].join)
  end

  test "問題が 5〜15 問なら作れる。16 問では作れない" do
    [ 5, 15 ].each do |n|
      assert QuizSession.prepare(user: organizer_with(n), title: "本番").valid?, "#{n} 問"
    end
    assert_not QuizSession.prepare(user: organizer_with(16), title: "本番").valid?
  end

  test "title は 1〜100 文字で、空白だけは無効" do
    user = organizer_with(5)

    assert_not QuizSession.prepare(user: user, title: "").valid?
    assert_not QuizSession.prepare(user: user, title: "   ").valid?
    assert_not QuizSession.prepare(user: user, title: "あ" * 101).valid?
    assert QuizSession.prepare(user: user, title: "あ" * 100).valid?
  end

  test "スナップショットは作成時の問題一式を出題順に持ち、あとで問題を直しても変わらない" do
    user = organizer_with(5)
    session = QuizSession.prepare(user: user, title: "本番")
    session.save!
    first = user.questions.first

    assert_equal 5, session.quiz_snapshot.size
    assert_equal({ "title" => "問題0", "choices" => %w[a b c d], "correctIndex" => 0, "imageKey" => nil }, session.quiz_snapshot.first)

    first.update!(title: "書き換えた")
    user.questions.last.destroy!

    assert_equal "問題0", session.reload.quiz_snapshot.first["title"]
    assert_equal 5, session.quiz_snapshot.size
  end

  test "画像つきの問題は blob の key をスナップショットに持つ" do
    user = organizer_with(5)
    question = user.questions.first
    question.image.attach(io: file_fixture("sample.png").open, filename: "sample.png", content_type: "image/png")
    question.save!

    session = QuizSession.prepare(user: user, title: "本番")

    assert_equal question.image.blob.key, session.quiz_snapshot.first["imageKey"]
  end

  test "host_password は DB 上で暗号文になっている" do
    session = QuizSession.prepare(user: organizer_with(5), title: "本番")
    session.save!

    raw = QuizSession.connection.select_value("SELECT host_password FROM quiz_sessions WHERE id = #{session.id}")

    assert_not_equal session.host_password, raw
    assert_no_match(/#{Regexp.escape(session.host_password)}/, raw)
    assert_equal session.host_password, session.reload.host_password
  end

  test "作成後に変えられない項目（public_id・スナップショット・ハッシュ）" do
    session = QuizSession.prepare(user: organizer_with(5), title: "本番")
    session.save!

    assert_raises(ActiveRecord::ReadonlyAttributeError) { session.update!(public_id: "other") }
    assert_raises(ActiveRecord::ReadonlyAttributeError) { session.update!(quiz_snapshot: []) }
    assert_raises(ActiveRecord::ReadonlyAttributeError) { session.update!(host_password_hash: "x") }
  end

  test "status は pending / ready / host_missing だけ" do
    session = QuizSession.prepare(user: organizer_with(5), title: "本番")

    %w[pending ready host_missing].each do |status|
      session.status = status
      assert session.valid?, status
    end
    session.status = "other"
    assert_not session.valid?
  end

  test "参列者・幹事の URL は LIVE_PUBLIC_URL と public_id から作る（トークンなし）" do
    session = QuizSession.prepare(user: organizer_with(5), title: "本番")
    original = ENV["LIVE_PUBLIC_URL"]
    ENV["LIVE_PUBLIC_URL"] = "https://live.example.com/"

    assert_equal "https://live.example.com/s/#{session.public_id}", session.guest_url
    assert_equal "https://live.example.com/host/#{session.public_id}", session.host_url
  ensure
    ENV["LIVE_PUBLIC_URL"] = original
  end
end
