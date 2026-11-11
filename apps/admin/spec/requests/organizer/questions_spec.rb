require "rails_helper"

RSpec.describe "Organizer questions", type: :request do
  let(:organizer) { create(:user) }
  let(:other_organizer) { create(:user) }
  let(:system_admin) { create(:user, :system_admin) }
  let!(:first_question) do
    create(:question, user: organizer, title: "新郎の好きな食べ物は？",
                      choice_a: "カレー", choice_b: "ラーメン", choice_c: "寿司", choice_d: "ハンバーグ", correct_index: 2)
  end
  let!(:second_question) { create(:question, user: organizer, title: "二人の出会いは？") }
  let!(:others_question) { create(:question, user: other_organizer, title: "他の主催者の問題") }
  let(:valid) { { title: "新しい問題", choice_a: "A", choice_b: "B", choice_c: "C", choice_d: "D", correct_index: "1" } }

  it "未ログインはログインへ" do
    get organizer_questions_path
    expect(response).to redirect_to(new_session_path)

    post organizer_questions_path, params: { question: valid }
    expect(response).to redirect_to(new_session_path)
  end

  it "一覧は自分の問題だけを作成順に出す" do
    sign_in_as organizer

    get organizer_questions_path

    expect(response).to have_http_status(:success)
    assert_select "li.question", 2
    assert_select "li.question:first-child", text: /新郎の好きな食べ物は？/
    expect(response.body).not_to match(/他の主催者の問題/)
  end

  it "新規作成: 入力フォームがあり、保存すると自分の問題になる" do
    sign_in_as organizer

    get new_organizer_question_path
    expect(response).to have_http_status(:success)
    assert_select "input[name='question[title]']"
    %w[a b c d].each { |c| assert_select "input[name='question[choice_#{c}]']" }
    assert_select "input[type=radio][name='question[correct_index]']", 4
    assert_select "input[type=file][data-direct-upload-url]"

    expect {
      post organizer_questions_path, params: { question: valid }
    }.to change { organizer.questions.count }.by(1)
    expect(response).to redirect_to(organizer_questions_path)
    expect(response).to have_http_status(:found)
    expect(organizer.questions.order(:id).last.correct_index).to eq 1
  end

  it "保存ボタンは画面下に固定され、選択肢は 2 列に並ぶ（1280x800 で見切れない）" do
    sign_in_as organizer

    get new_organizer_question_path

    assert_select "form .choices > .choice input[type=text]", 4
    assert_select "form .form-actions--sticky input[type=submit][value=保存]"

    css = Rails.root.glob("app/assets/stylesheets/*.css").map(&:read).join
    expect(css).to match(/\.form-actions--sticky\s*\{[^}]*position:\s*sticky/)
    expect(css).to match(/\.choices\s*\{[^}]*grid-template-columns:\s*repeat\(2/)
    expect(css).to match(/\.field_with_errors\s*\{[^}]*display:\s*contents/)
  end

  it "user_id は params から受けず、必ずログイン中のユーザーになる" do
    sign_in_as organizer

    post organizer_questions_path, params: { question: valid.merge(user_id: other_organizer.id) }

    expect(Question.order(:id).last.user).to eq organizer
  end

  it "不正な入力は 422 で作らない" do
    sign_in_as organizer

    expect {
      post organizer_questions_path, params: { question: valid.merge(choice_d: "", correct_index: "4") }
    }.not_to change(Question, :count)
    expect(response).to have_http_status(:unprocessable_content)
    assert_select ".error li"
  end

  it "検証エラーは日本語で出す（正解未選択・同じ文言の選択肢）" do
    sign_in_as organizer

    post organizer_questions_path, params: { question: valid.merge(correct_index: "", choice_b: "A") }

    expect(response).to have_http_status(:unprocessable_content)
    assert_select ".error li", text: "正解を選んでください"
    assert_select ".error li", text: "選択肢 Aは他の選択肢と同じ文言です。違う文言にしてください"
    assert_select ".error li", text: "選択肢 Bは他の選択肢と同じ文言です。違う文言にしてください"
    expect(response.body).not_to match(/is not a number|translation missing/i)
    # エラー表示でも選択肢 4 つが 2 列の並びのまま（p の中に div が入ってブラウザに閉じられない）
    assert_select ".choices > .choice", 4
  end

  it "編集と更新ができる。画像を送らなければ今の画像を残す" do
    sign_in_as organizer
    question = first_question
    question.image.attach(io: file_fixture("sample.png").open, filename: "sample.png", content_type: "image/png")
    question.save!

    get edit_organizer_question_path(question)
    expect(response).to have_http_status(:success)
    assert_select "img.preview"

    patch organizer_question_path(question), params: { question: valid.merge(title: "更新後", image: "") }
    expect(response).to redirect_to(organizer_questions_path)
    expect(response).to have_http_status(:see_other)
    expect(question.reload.title).to eq "更新後"
    expect(question.image).to be_attached
  end

  it "direct upload の signed_id で画像を付けられる" do
    sign_in_as organizer
    blob = ActiveStorage::Blob.create_and_upload!(io: file_fixture("sample.png").open, filename: "sample.png", content_type: "image/png")

    post organizer_questions_path, params: { question: valid.merge(image: blob.signed_id) }

    expect(Question.order(:id).last.image.blob).to eq blob
  end

  it "削除できる" do
    sign_in_as organizer

    expect {
      delete organizer_question_path(first_question)
    }.to change(Question, :count).by(-1)
    expect(response).to redirect_to(organizer_questions_path)
    expect(response).to have_http_status(:see_other)
  end

  it "他の主催者の問題は 404（見る・編集・更新・削除）" do
    sign_in_as organizer
    other = others_question

    get edit_organizer_question_path(other)
    expect(response).to have_http_status(:not_found)
    patch organizer_question_path(other), params: { question: { title: "乗っ取り" } }
    expect(response).to have_http_status(:not_found)
    expect {
      delete organizer_question_path(other)
    }.not_to change(Question, :count)
    expect(response).to have_http_status(:not_found)
    expect(other.reload.title).to eq "他の主催者の問題"
  end

  it "システム管理者が入ると、自分の（空の）問題セットを見る" do
    sign_in_as system_admin

    get organizer_questions_path

    expect(response).to have_http_status(:success)
    assert_select "li.question", 0
  end

  it "画面で importmap と Active Storage の JS が解決できる" do
    sign_in_as organizer

    get new_organizer_question_path

    expect(response.body).to match(/activestorage/)
  end
end
