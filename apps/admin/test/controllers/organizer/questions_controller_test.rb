require "test_helper"

class Organizer::QuestionsControllerTest < ActionDispatch::IntegrationTest
  VALID = { title: "新しい問題", choice_a: "A", choice_b: "B", choice_c: "C", choice_d: "D", correct_index: "1" }.freeze

  test "未ログインはログインへ" do
    get organizer_questions_path
    assert_redirected_to new_session_path

    post organizer_questions_path, params: { question: VALID }
    assert_redirected_to new_session_path
  end

  test "一覧は自分の問題だけを作成順に出す" do
    sign_in_as users(:organizer)

    get organizer_questions_path

    assert_response :success
    assert_select "li.question", 2
    assert_select "li.question:first-child", text: /新郎の好きな食べ物は？/
    assert_no_match(/他の主催者の問題/, response.body)
  end

  test "新規作成: 入力フォームがあり、保存すると自分の問題になる" do
    sign_in_as users(:organizer)

    get new_organizer_question_path
    assert_response :success
    assert_select "input[name='question[title]']"
    %w[a b c d].each { |c| assert_select "input[name='question[choice_#{c}]']" }
    assert_select "input[type=radio][name='question[correct_index]']", 4
    assert_select "input[type=file][data-direct-upload-url]"

    assert_difference -> { users(:organizer).questions.count }, 1 do
      post organizer_questions_path, params: { question: VALID }
    end
    assert_redirected_to organizer_questions_path
    assert_equal 1, users(:organizer).questions.order(:id).last.correct_index
  end

  test "user_id は params から受けず、必ずログイン中のユーザーになる" do
    sign_in_as users(:organizer)

    post organizer_questions_path, params: { question: VALID.merge(user_id: users(:other_organizer).id) }

    assert_equal users(:organizer), Question.order(:id).last.user
  end

  test "不正な入力は 422 で作らない" do
    sign_in_as users(:organizer)

    assert_no_difference "Question.count" do
      post organizer_questions_path, params: { question: VALID.merge(choice_d: "", correct_index: "4") }
    end
    assert_response :unprocessable_entity
    assert_select ".error li"
  end

  test "検証エラーは日本語で出す（正解未選択・同じ文言の選択肢）" do
    sign_in_as users(:organizer)

    post organizer_questions_path, params: { question: VALID.merge(correct_index: "", choice_b: "A") }

    assert_response :unprocessable_entity
    assert_select ".error li", text: "正解を選んでください"
    assert_select ".error li", text: "選択肢 Aは他の選択肢と同じ文言です。違う文言にしてください"
    assert_select ".error li", text: "選択肢 Bは他の選択肢と同じ文言です。違う文言にしてください"
    assert_no_match(/is not a number|translation missing/i, response.body)
  end

  test "編集と更新ができる。画像を送らなければ今の画像を残す" do
    sign_in_as users(:organizer)
    question = questions(:first)
    question.image.attach(io: file_fixture("sample.png").open, filename: "sample.png", content_type: "image/png")
    question.save!

    get edit_organizer_question_path(question)
    assert_response :success
    assert_select "img.preview"

    patch organizer_question_path(question), params: { question: VALID.merge(title: "更新後", image: "") }
    assert_redirected_to organizer_questions_path
    assert_equal "更新後", question.reload.title
    assert question.image.attached?
  end

  test "direct upload の signed_id で画像を付けられる" do
    sign_in_as users(:organizer)
    blob = ActiveStorage::Blob.create_and_upload!(io: file_fixture("sample.png").open, filename: "sample.png", content_type: "image/png")

    post organizer_questions_path, params: { question: VALID.merge(image: blob.signed_id) }

    assert_equal blob, Question.order(:id).last.image.blob
  end

  test "削除できる" do
    sign_in_as users(:organizer)

    assert_difference "Question.count", -1 do
      delete organizer_question_path(questions(:first))
    end
    assert_redirected_to organizer_questions_path
  end

  test "他の主催者の問題は 404（見る・編集・更新・削除）" do
    sign_in_as users(:organizer)
    other = questions(:others)

    get edit_organizer_question_path(other)
    assert_response :not_found
    patch organizer_question_path(other), params: { question: { title: "乗っ取り" } }
    assert_response :not_found
    assert_no_difference "Question.count" do
      delete organizer_question_path(other)
    end
    assert_response :not_found
    assert_equal "他の主催者の問題", other.reload.title
  end

  test "システム管理者が入ると、自分の（空の）問題セットを見る" do
    sign_in_as users(:system_admin)

    get organizer_questions_path

    assert_response :success
    assert_select "li.question", 0
  end

  test "画面で importmap と Active Storage の JS が解決できる" do
    sign_in_as users(:organizer)

    get new_organizer_question_path

    assert_match(/activestorage/, response.body)
  end
end
