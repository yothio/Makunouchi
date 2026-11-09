require "rails_helper"

RSpec.describe Question, "delivery_image", type: :model do
  include ActiveJob::TestHelper

  it "画像を付けたら GenerateDeliveryImageJob を積む" do
    question = create(:question)

    expect {
      question.image.attach(
        io: file_fixture("sample.png").open,
        filename: "sample.png",
        content_type: "image/png"
      )
      question.save!
    }.to have_enqueued_job(GenerateDeliveryImageJob).with(question.id)
  end

  it "live_image_key は現原画と対応する派生があるときだけその key、無ければ原画の key" do
    question = create(:question)
    question.image.attach(
      io: file_fixture("sample.png").open,
      filename: "sample.png",
      content_type: "image/png"
    )
    question.save!

    expect(question.live_image_key).to eq question.image.blob.key

    perform_enqueued_jobs only: GenerateDeliveryImageJob
    question.reload

    expect(question.delivery_image).to be_attached
    expect(question.live_image_key).to eq question.delivery_image.blob.key
    expect(question.live_image_key).not_to eq question.image.blob.key
  end

  it "古い原画向けの派生が付いていても live_image_key は現原画の key を返す" do
    question = create(:question)
    question.image.attach(
      io: file_fixture("sample.png").open,
      filename: "sample.png",
      content_type: "image/png"
    )
    question.save!
    perform_enqueued_jobs only: GenerateDeliveryImageJob
    question.reload
    old_blob = question.image.blob
    stale_delivery = question.delivery_image.blob

    question.image.attach(
      io: file_fixture("sample2.png").open,
      filename: "sample2.png",
      content_type: "image/png"
    )
    question.save!
    clear_enqueued_jobs

    # 差し替えで一度外れたあとに、古いジョブが古い派生を付け直した状態を再現する
    question.delivery_image.attach(stale_delivery)
    question.reload

    expect(question.delivery_image).to be_attached
    expect(question.delivery_ready_for?(question.image.blob)).to be false
    expect(stale_delivery.metadata["source_blob_id"].to_s).to eq old_blob.id.to_s
    expect(question.live_image_key).to eq question.image.blob.key
  end

  it "画像を差し替えたら古い delivery_image を外し、再変換のジョブを積む" do
    question = create(:question)
    question.image.attach(
      io: file_fixture("sample.png").open,
      filename: "sample.png",
      content_type: "image/png"
    )
    question.save!
    perform_enqueued_jobs only: GenerateDeliveryImageJob
    question.reload
    old_delivery_blob = question.delivery_image.blob

    expect {
      question.image.attach(
        io: file_fixture("sample2.png").open,
        filename: "sample2.png",
        content_type: "image/png"
      )
      question.save!
    }.to have_enqueued_job(GenerateDeliveryImageJob).with(question.id)

    question.reload
    expect(question.delivery_image).not_to be_attached
    expect(ActiveStorage::Blob.exists?(old_delivery_blob.id)).to be true
  end
end
