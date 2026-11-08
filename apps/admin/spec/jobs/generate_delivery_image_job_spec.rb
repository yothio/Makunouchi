require "rails_helper"

RSpec.describe GenerateDeliveryImageJob, type: :job do
  include ActiveJob::TestHelper

  it "原画から長辺 1280 以下の WebP を delivery_image に付ける" do
    question = create(:question)
    question.image.attach(
      io: file_fixture("large_sample.png").open,
      filename: "large_sample.png",
      content_type: "image/png"
    )
    question.save!

    perform_enqueued_jobs only: GenerateDeliveryImageJob

    question.reload
    expect(question.delivery_image).to be_attached
    expect(question.delivery_image.blob.content_type).to eq "image/webp"
    expect(question.delivery_image.blob.filename.extension).to eq "webp"

    question.delivery_image.blob.open do |file|
      image = Vips::Image.new_from_file(file.path)
      expect([ image.width, image.height ].max).to be <= Question::DELIVERY_MAX_EDGE
    end
  end

  it "変換に失敗しても原画は残り、delivery_image は付かない" do
    question = create(:question)
    question.image.attach(
      io: file_fixture("sample.png").open,
      filename: "sample.png",
      content_type: "image/png"
    )
    question.save!

    allow(ImageProcessing::Vips).to receive(:source).and_raise(Vips::Error, "boom")

    expect {
      perform_enqueued_jobs only: GenerateDeliveryImageJob
    }.not_to raise_error

    question.reload
    expect(question.image).to be_attached
    expect(question.delivery_image).not_to be_attached
  end
end
