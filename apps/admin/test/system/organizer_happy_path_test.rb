require "application_system_test_case"

class OrganizerHappyPathTest < ApplicationSystemTestCase
  class FakeLiveClient
    def create_session(_session_id, _payload) = :created
  end

  setup do
    QuizSessionRegistrar.client_factory = -> { FakeLiveClient.new }
    @user = users(:organizer)
    @user.questions.destroy_all
    5.times do |i|
      @user.questions.create!(
        title: "問題#{i}",
        choice_a: "a", choice_b: "b", choice_c: "c", choice_d: "d",
        correct_index: i % 4
      )
    end
  end

  teardown do
    QuizSessionRegistrar.client_factory = nil
  end

  test "ログインして開催回を作ると live 登録済みになる" do
    visit new_session_path
    fill_in "メールアドレス", with: @user.email
    fill_in "パスワード", with: SignInHelper::PASSWORD
    click_button "ログイン"

    visit new_organizer_quiz_session_path
    fill_in "開催回名", with: "本番リハーサル"
    click_button "作成"

    assert_text "登録済み"
    assert_text "本番リハーサル"
    session = @user.quiz_sessions.order(:id).last
    assert session.ready?
    assert_text session.host_login_id
  end
end
