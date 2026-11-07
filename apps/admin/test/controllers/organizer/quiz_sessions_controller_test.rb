require "test_helper"

class Organizer::QuizSessionsControllerTest < ActionDispatch::IntegrationTest
  def add_questions(user, count)
    user.questions.destroy_all
    count.times do |i|
      user.questions.create!(title: "問題#{i}", choice_a: "a", choice_b: "b", choice_c: "c", choice_d: "d", correct_index: i % 4)
    end
  end

  test "未ログインはログインへ" do
    get new_organizer_quiz_session_path
    assert_redirected_to new_session_path

    post organizer_quiz_sessions_path, params: { quiz_session: { title: "x" } }
    assert_redirected_to new_session_path
  end

  test "作成画面は開催回名だけを入力する" do
    sign_in_as users(:organizer)

    get new_organizer_quiz_session_path

    assert_response :success
    assert_select "input[name='quiz_session[title]']"
    assert_select "a[href=?]", root_path
  end

  test "問題が 5 問以上あれば作成でき、詳細に幹事の ID/PASS と作成時の質問解答が出る" do
    user = users(:organizer)
    add_questions(user, 5)
    sign_in_as user

    assert_difference -> { user.quiz_sessions.count }, 1 do
      post organizer_quiz_sessions_path, params: { quiz_session: { title: "本番" } }
    end
    created = user.quiz_sessions.order(:id).last
    assert_redirected_to organizer_quiz_session_path(created)
    follow_redirect!

    assert_response :success
    assert_select ".host-login-id", text: created.host_login_id
    assert_select ".host-password", text: created.host_password
    assert_select "li.snapshot-question", 5
    assert_match(/問題0/, response.body)
    assert_select "a[href=?]", root_path
  end

  test "問題が 4 問や 16 問では作れず、理由を伝える" do
    user = users(:organizer)
    sign_in_as user

    [ 4, 16 ].each do |count|
      add_questions(user, count)
      assert_no_difference "QuizSession.count" do
        post organizer_quiz_sessions_path, params: { quiz_session: { title: "本番" } }
      end
      assert_response :unprocessable_entity
      assert_select ".error li", text: /5〜15/
    end
  end

  test "params の user_id・status・public_id・幹事 ID は受け付けない" do
    user = users(:organizer)
    add_questions(user, 5)
    sign_in_as user

    post organizer_quiz_sessions_path, params: { quiz_session: {
      title: "本番", user_id: users(:other_organizer).id, status: "ready", public_id: "mine", host_login_id: "attacker1"
    } }

    created = QuizSession.order(:id).last
    assert_equal user, created.user
    assert created.pending?
    assert_not_equal "mine", created.public_id
    assert_not_equal "attacker1", created.host_login_id
  end

  test "他の主催者の開催回は 404" do
    other = users(:other_organizer)
    add_questions(other, 5)
    session = QuizSession.prepare(user: other, title: "他人の").tap(&:save!)
    sign_in_as users(:organizer)

    get organizer_quiz_session_path(session)

    assert_response :not_found
  end

  test "幹事パスワードを出す詳細は no-store（戻るボタンやキャッシュに残さない）" do
    user = users(:organizer)
    add_questions(user, 5)
    session = QuizSession.prepare(user: user, title: "本番").tap(&:save!)
    sign_in_as user

    get organizer_quiz_session_path(session)

    assert_includes response.headers["Cache-Control"], "no-store"
  end

  test "作成ボタンは送信中に無効になる（二重送信で開催回が 2 つできないように）" do
    sign_in_as users(:organizer)

    get new_organizer_quiz_session_path

    assert_select "input[type=submit][data-turbo-submits-with]"
  end

  test "トップに開催回の件数と一覧（タイトル）と作成ボタンが出る" do
    user = users(:organizer)
    add_questions(user, 5)
    QuizSession.prepare(user: user, title: "リハーサル").save!
    sign_in_as user

    get root_path

    assert_select ".quiz-session-count", text: /1/
    assert_select "li.quiz-session a", text: "リハーサル"
    assert_select "a[href=?]", new_organizer_quiz_session_path
  end

  test "システム管理者も自分の開催回を作れる（問題が足りなければ作れない）" do
    sign_in_as users(:system_admin)

    assert_no_difference "QuizSession.count" do
      post organizer_quiz_sessions_path, params: { quiz_session: { title: "管理者の" } }
    end
    assert_response :unprocessable_entity
  end

  test "開催回に update の経路は無い（スナップショットを差し替えられない）" do
    user = users(:organizer)
    add_questions(user, 5)
    session = QuizSession.prepare(user: user, title: "本番").tap(&:save!)
    sign_in_as user

    patch "/organizer/quiz_sessions/#{session.id}", params: { quiz_session: { title: "x" } }

    assert_response :not_found
    assert_equal "本番", session.reload.title
  end

  test "パスワードをログに出さない" do
    filtered = ActiveSupport::ParameterFilter.new(Rails.application.config.filter_parameters)
      .filter("host_password" => "abcdefghjkmn", "host_login_id" => "abcdefgh")

    assert_equal(%w[[FILTERED]], filtered.values.uniq)
  end
end
