require "rails_helper"

RSpec.describe "主催者のハッピーパス", type: :system do
  let!(:user) { create(:user) }

  before do
    QuizSession.live_client_factory = -> { FakeLiveClient.new }
    create_list(:question, 5, user: user)
  end

  after do
    QuizSession.live_client_factory = nil
  end

  it "ログインして開催回を作ると live 登録済みになる" do
    visit new_session_path
    fill_in "メールアドレス", with: user.email
    fill_in "パスワード", with: SignInHelper::PASSWORD
    click_button "ログイン"

    visit new_organizer_quiz_session_path
    fill_in "開催回名", with: "本番リハーサル"
    click_button "作成"

    expect(page).to have_text "登録済み"
    expect(page).to have_text "本番リハーサル"
    session = user.quiz_sessions.order(:id).last
    expect(session).to be_ready
    expect(page).to have_text session.host_login_id
  end
end
