require "rails_helper"
require Rails.root.join("lib/r2_endpoint")

RSpec.describe R2Endpoint do
  describe ".validate!" do
    it "本番以外ではパス付きでも何もしない" do
      expect {
        described_class.validate!(
          "https://example.r2.cloudflarestorage.com/bucket-name",
          production: false
        )
      }.not_to raise_error
    end

    it "本番で未設定なら何もしない（欠落は storage.yml の ENV.fetch が止める）" do
      expect {
        described_class.validate!(nil, production: true)
      }.not_to raise_error

      expect {
        described_class.validate!("", production: true)
      }.not_to raise_error
    end

    it "本番でオリジンだけの URL は通す" do
      expect {
        described_class.validate!(
          "https://example.r2.cloudflarestorage.com",
          production: true
        )
      }.not_to raise_error
    end

    it "本番で末尾スラッシュだけのパスは通す" do
      expect {
        described_class.validate!(
          "https://example.r2.cloudflarestorage.com/",
          production: true
        )
      }.not_to raise_error
    end

    it "本番でバケット名などのパスが付いていたら分かりやすいメッセージで止める" do
      expect {
        described_class.validate!(
          "https://example.r2.cloudflarestorage.com/bucket-name",
          production: true
        )
      }.to raise_error(
        R2Endpoint::Invalid,
        /R2_ENDPOINT.*パスを含めない.*R2_BUCKET.*S3 API/
      )
    end

    it "本番で URL として不正なら止める" do
      expect {
        described_class.validate!("not a url", production: true)
      }.to raise_error(R2Endpoint::Invalid, /R2_ENDPOINT/)
    end
  end
end
