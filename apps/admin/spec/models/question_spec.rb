require "rails_helper"

RSpec.describe Question, type: :model do
  include ActiveJob::TestHelper

  it "4 択がそろっていれば有効" do
    expect(build(:question)).to be_valid
  end

  it "title は 1〜200 文字" do
    expect(build(:question, title: "")).not_to be_valid
    expect(build(:question, title: "あ" * 201)).not_to be_valid
    expect(build(:question, title: "あ" * 200)).to be_valid
  end

  it "選択肢は A〜D の 4 つとも 1〜50 文字（3 つ相当は無効）" do
    expect(build(:question, choice_d: "")).not_to be_valid
    expect(build(:question, choice_c: nil)).not_to be_valid
    expect(build(:question, choice_a: "あ" * 51)).not_to be_valid
    expect(build(:question, choice_a: "あ" * 50)).to be_valid
  end

  it "空白だけのタイトル・選択肢は無効。前後の空白は取り除いて保存する" do
    expect(build(:question, title: "   ")).not_to be_valid
    expect(build(:question, choice_a: " ")).not_to be_valid

    question = build(:question, title: "  問題  ", choice_b: " B ")
    question.save!
    expect(question.reload.title).to eq "問題"
    expect(question.choice_b).to eq "B"
  end

  it "同じ文言の選択肢は無効（前後の空白を除いて比べる）" do
    question = build(:question, choice_a: "カレー", choice_b: " カレー ")

    expect(question).not_to be_valid
    expect(question.errors.of_kind?(:choice_a, :duplicate_choice)).to be true
    expect(question.errors.of_kind?(:choice_b, :duplicate_choice)).to be true
    expect(question.errors.key?(:choice_c)).to be false
    expect(question.errors.full_messages).to include "選択肢 Aは他の選択肢と同じ文言です。違う文言にしてください"
  end

  it "空の選択肢どうしは重複とは数えない（空欄の指摘だけ出す）" do
    question = build(:question, choice_c: "", choice_d: "")

    expect(question).not_to be_valid
    expect(question.errors.of_kind?(:choice_c, :duplicate_choice)).to be false
  end

  it "検証エラーのメッセージは日本語" do
    question = build(:question, title: "", choice_a: "あ" * 51, correct_index: nil)
    question.image.attach(io: file_fixture("not_image.txt").open, filename: "x.txt", content_type: "text/plain")
    question.valid?

    messages = question.errors.full_messages
    expect(messages).to include "質問のタイトルは1文字以上で入力してください"
    expect(messages).to include "選択肢 Aは50文字以内で入力してください"
    expect(messages).to include "正解を選んでください"
    expect(messages).to include "画像は png / jpeg / webp / gif のいずれかにしてください"
    expect(messages.none? { |message| message.match?(/\A[A-Za-z]|is |must |can't/) }).to be(true), messages.inspect

    expect(build(:question, correct_index: 4).tap(&:valid?).errors.full_messages).to include "正解は A〜D から選んでください"
  end

  it "choices は A〜D の順の配列" do
    question = build(:question, choice_a: "カレー", choice_b: "ラーメン", choice_c: "寿司", choice_d: "ハンバーグ")

    expect(question.choices).to eq %w[カレー ラーメン 寿司 ハンバーグ]
  end

  it "correct_index は 0〜3 の整数" do
    expect(build(:question, correct_index: 4)).not_to be_valid
    expect(build(:question, correct_index: -1)).not_to be_valid
    expect(build(:question, correct_index: nil)).not_to be_valid
    expect(build(:question, correct_index: 1.5)).not_to be_valid
    (0..3).each { |i| expect(build(:question, correct_index: i)).to be_valid }
  end

  it "配点と並び順のカラムは持たない" do
    expect(%w[points position topN top_n] & Question.column_names).to be_empty
  end

  it "出題順は作成順（id 昇順）" do
    user = create(:user)
    created = create_list(:question, 3, user: user)

    expect(user.questions.to_a).to eq created
  end

  it "画像は任意で、png / jpeg / webp / gif だけ" do
    question = build(:question)
    expect(question).to be_valid

    question.image.attach(io: file_fixture("sample.png").open, filename: "sample.png", content_type: "image/png")
    expect(question).to be_valid

    bad = build(:question)
    bad.image.attach(io: file_fixture("not_image.txt").open, filename: "x.txt", content_type: "text/plain")
    expect(bad).not_to be_valid
    expect(bad.errors.of_kind?(:image, :invalid)).to be true
  end

  it "画像のサイズは上限（5 MB）まで" do
    question = build(:question)
    question.image.attach(io: StringIO.new("x" * (Question::IMAGE_MAX_BYTES + 1)), filename: "big.png", content_type: "image/png")

    expect(question).not_to be_valid
    expect(question.errors.of_kind?(:image, :too_long)).to be true
  end

  it "画像を差し替えても、古い blob は消さない" do
    question = create(:question, :with_image)
    old_blob = question.image.blob

    assert_no_enqueued_jobs only: ActiveStorage::PurgeJob do
      question.image.attach(io: file_fixture("sample2.png").open, filename: "sample2.png", content_type: "image/png")
      question.save!
    end

    expect(question.reload.image.blob).not_to eq old_blob
    expect(ActiveStorage::Blob.exists?(old_blob.id)).to be true
  end
end
