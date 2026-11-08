class Question < ApplicationRecord
  IMAGE_CONTENT_TYPES = %w[image/png image/jpeg image/webp image/gif].freeze
  IMAGE_MAX_BYTES = 5.megabytes
  DELIVERY_MAX_EDGE = 1280
  CHOICE_COLUMNS = %i[choice_a choice_b choice_c choice_d].freeze

  belongs_to :user

  # 差し替え・削除のときも古い blob（R2 のオブジェクト）は消さない。
  # 開催回に取り込んだスナップショットが画像の URL を持つため。
  has_one_attached :image, dependent: false
  has_one_attached :delivery_image, dependent: false

  normalizes :title, *CHOICE_COLUMNS, with: ->(value) { value.strip }

  validates :title, length: { in: 1..200 }
  validates(*CHOICE_COLUMNS, length: { in: 1..50 })
  validates :correct_index, numericality: { only_integer: true, in: 0..3 }
  validate :image_is_acceptable
  validate :choices_are_distinct

  def choices
    CHOICE_COLUMNS.map { |column| self[column] }
  end

  # live に渡す画像キー。現原画と対応する派生だけ使い、それ以外は原画（欠けないことを優先）。
  def live_image_key
    return unless image.attached?
    return delivery_image.blob.key if delivery_ready_for?(image.blob)

    image.blob.key
  end

  def delivery_ready_for?(source_blob)
    delivery_image.attached? &&
      delivery_image.blob.metadata["source_blob_id"].to_s == source_blob.id.to_s
  end

  def enqueue_delivery_image_generation
    return unless image.attached?
    return if delivery_ready_for?(image.blob)

    delivery_image.detach if delivery_image.attached?
    GenerateDeliveryImageJob.perform_later(id)
  end

  private

  # 1 つの問題の中で同じ文言の選択肢は入力エラー（前後の空白は normalizes で取り除いてある）。
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
