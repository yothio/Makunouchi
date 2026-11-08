class Question < ApplicationRecord
  IMAGE_CONTENT_TYPES = %w[image/png image/jpeg image/webp image/gif].freeze
  IMAGE_MAX_BYTES = 5.megabytes
  CHOICE_COLUMNS = %i[choice_a choice_b choice_c choice_d].freeze

  belongs_to :user

  # 決定 5A: 差し替え・削除のときも古い blob（R2 のオブジェクト）は消さない。
  # 開催回に取り込んだスナップショットが画像の URL を持つため。
  has_one_attached :image, dependent: false

  # 空白だけの入力は、前後の空白を取り除いたあとの長さの検証で弾く。
  normalizes :title, *CHOICE_COLUMNS, with: ->(value) { value.strip }

  validates :title, length: { in: 1..200 }
  validates(*CHOICE_COLUMNS, length: { in: 1..50 })
  validates :correct_index, numericality: { only_integer: true, in: 0..3 }
  validate :image_is_acceptable
  validate :choices_are_distinct

  # 出題順は作成順（id 昇順）。配点・並べ替えは持たない。
  def choices
    CHOICE_COLUMNS.map { |column| self[column] }
  end

  private

  # ユーザー決定: 1 つの問題の中で同じ文言の選択肢は入力エラー（前後の空白は normalizes で取り除いてある）。
  def choices_are_distinct
    present = CHOICE_COLUMNS.select { |column| self[column].present? }
    present.group_by { |column| self[column] }.each_value do |columns|
      columns.each { |column| errors.add(column, :duplicate_choice) } if columns.size > 1
    end
  end

  def image_is_acceptable
    return unless image.attached?

    errors.add(:image, :invalid) unless IMAGE_CONTENT_TYPES.include?(image.blob.content_type)
    errors.add(:image, :too_long, count: IMAGE_MAX_BYTES / 1.megabyte) if image.blob.byte_size > IMAGE_MAX_BYTES
  end
end
