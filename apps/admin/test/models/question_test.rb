require "test_helper"

class QuestionTest < ActiveSupport::TestCase
  include ActiveJob::TestHelper

  def build(**attrs)
    Question.new({ user: users(:organizer), title: "問題", choice_a: "A", choice_b: "B", choice_c: "C", choice_d: "D", correct_index: 0 }.merge(attrs))
  end

  test "4 択がそろっていれば有効" do
    assert build.valid?
  end

  test "title は 1〜200 文字" do
    assert_not build(title: "").valid?
    assert_not build(title: "あ" * 201).valid?
    assert build(title: "あ" * 200).valid?
  end

  test "選択肢は A〜D の 4 つとも 1〜50 文字（3 つ相当は無効）" do
    assert_not build(choice_d: "").valid?
    assert_not build(choice_c: nil).valid?
    assert_not build(choice_a: "あ" * 51).valid?
    assert build(choice_a: "あ" * 50).valid?
  end

  test "空白だけのタイトル・選択肢は無効。前後の空白は取り除いて保存する" do
    assert_not build(title: "   ").valid?
    assert_not build(choice_a: " ").valid?

    question = build(title: "  問題  ", choice_b: " B ")
    question.save!
    assert_equal "問題", question.reload.title
    assert_equal "B", question.choice_b
  end

  test "同じ文言の選択肢は無効（前後の空白を除いて比べる）" do
    question = build(choice_a: "カレー", choice_b: " カレー ")

    assert_not question.valid?
    assert question.errors.of_kind?(:choice_a, :duplicate_choice)
    assert question.errors.of_kind?(:choice_b, :duplicate_choice)
    assert_not question.errors.key?(:choice_c)
    assert_includes question.errors.full_messages, "選択肢 Aは他の選択肢と同じ文言です。違う文言にしてください"
  end

  test "空の選択肢どうしは重複とは数えない（空欄の指摘だけ出す）" do
    question = build(choice_c: "", choice_d: "")

    assert_not question.valid?
    assert_not question.errors.of_kind?(:choice_c, :duplicate_choice)
  end

  test "検証エラーのメッセージは日本語" do
    question = build(title: "", choice_a: "あ" * 51, correct_index: nil)
    question.image.attach(io: file_fixture("not_image.txt").open, filename: "x.txt", content_type: "text/plain")
    question.valid?

    messages = question.errors.full_messages
    assert_includes messages, "質問のタイトルは1文字以上で入力してください"
    assert_includes messages, "選択肢 Aは50文字以内で入力してください"
    assert_includes messages, "正解を選んでください"
    assert_includes messages, "画像は png / jpeg / webp / gif のいずれかにしてください"
    assert messages.none? { |message| message.match?(/\A[A-Za-z]|is |must |can't/) }, messages.inspect

    assert_includes build(correct_index: 4).tap(&:valid?).errors.full_messages, "正解は A〜D から選んでください"
  end

  test "choices は A〜D の順の配列" do
    assert_equal %w[カレー ラーメン 寿司 ハンバーグ], questions(:first).choices
  end

  test "correct_index は 0〜3 の整数" do
    assert_not build(correct_index: 4).valid?
    assert_not build(correct_index: -1).valid?
    assert_not build(correct_index: nil).valid?
    assert_not build(correct_index: 1.5).valid?
    (0..3).each { |i| assert build(correct_index: i).valid? }
  end

  test "配点と並び順のカラムは持たない" do
    assert_empty %w[points position topN top_n] & Question.column_names
  end

  test "出題順は作成順（id 昇順）" do
    assert_equal users(:organizer).questions.order(:id).to_a, users(:organizer).questions.to_a
  end

  test "画像は任意で、png / jpeg / webp / gif だけ" do
    question = build
    assert question.valid?

    question.image.attach(io: file_fixture("sample.png").open, filename: "sample.png", content_type: "image/png")
    assert question.valid?

    bad = build
    bad.image.attach(io: file_fixture("not_image.txt").open, filename: "x.txt", content_type: "text/plain")
    assert_not bad.valid?
    assert bad.errors.of_kind?(:image, :invalid)
  end

  test "画像のサイズは上限（5 MB）まで" do
    question = build
    question.image.attach(io: StringIO.new("x" * (Question::IMAGE_MAX_BYTES + 1)), filename: "big.png", content_type: "image/png")

    assert_not question.valid?
    assert question.errors.of_kind?(:image, :too_long)
  end

  test "画像を差し替えても、古い blob は消さない（決定 5A）" do
    question = questions(:first)
    question.image.attach(io: file_fixture("sample.png").open, filename: "sample.png", content_type: "image/png")
    question.save!
    old_blob = question.image.blob

    assert_no_enqueued_jobs only: ActiveStorage::PurgeJob do
      question.image.attach(io: file_fixture("sample2.png").open, filename: "sample2.png", content_type: "image/png")
      question.save!
    end

    assert_not_equal old_blob, question.reload.image.blob
    assert ActiveStorage::Blob.exists?(old_blob.id)
  end
end
