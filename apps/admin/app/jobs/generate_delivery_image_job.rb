class GenerateDeliveryImageJob < ApplicationJob
  queue_as :default

  def perform(question_id)
    processed = nil
    question = Question.find_by(id: question_id)
    return unless question&.image&.attached?

    source = question.image.blob
    return if question.delivery_ready_for?(source)

    source.open do |file|
      processed = ImageProcessing::Vips
        .source(file)
        .resize_to_limit(Question::DELIVERY_MAX_EDGE, Question::DELIVERY_MAX_EDGE)
        .convert("webp")
        .call
    end

    File.open(processed.path, "rb") do |io|
      question.delivery_image.attach(
        io: io,
        filename: "#{source.filename.base}.webp",
        content_type: "image/webp",
        metadata: { "source_blob_id" => source.id }
      )
    end
  rescue StandardError => error
    Rails.logger.error("[GenerateDeliveryImageJob] question_id=#{question_id} #{error.class}: #{error.message}")
  ensure
    cleanup_processed(processed)
  end

  private

  def cleanup_processed(processed)
    return unless processed

    processed.close
    processed.unlink if processed.respond_to?(:unlink) && File.exist?(processed.path)
  end
end
