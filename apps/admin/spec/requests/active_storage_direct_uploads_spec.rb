require "rails_helper"

RSpec.describe "Active Storage の direct upload", type: :request do
  def blob_params(**overrides)
    {
      blob: {
        filename: "photo.png", content_type: "image/png", byte_size: 1234,
        checksum: Base64.strict_encode64(Digest::MD5.digest("x"))
      }.merge(overrides)
    }
  end

  def issue(**overrides)
    post rails_direct_uploads_path, params: blob_params(**overrides), as: :json
  end

  it "未ログインは 401 で、presigned URL を発行しない" do
    expect { issue }.not_to change(ActiveStorage::Blob, :count)

    expect(response).to have_http_status(:unauthorized)
  end

  it "ログイン済みの主催者は発行できる" do
    sign_in_as users(:organizer)

    expect { issue }.to change(ActiveStorage::Blob, :count).by(1)

    expect(response).to have_http_status(:success)
    expect(response.parsed_body["direct_upload"]["url"]).to be_present
  end

  it "システム管理者も発行できる（主催者用の画面に入れる決定と揃える）" do
    sign_in_as users(:system_admin)

    issue

    expect(response).to have_http_status(:success)
  end

  it "許可しない content_type は 422" do
    sign_in_as users(:organizer)

    expect { issue(content_type: "text/html") }.not_to change(ActiveStorage::Blob, :count)
    expect(response).to have_http_status(:unprocessable_content)
  end

  it "許可する 4 種類は通る" do
    sign_in_as users(:organizer)

    %w[image/png image/jpeg image/webp image/gif].each do |type|
      issue(content_type: type)
      expect(response).to have_http_status(:success), type
    end
  end

  it "上限を超えるサイズは 422、ちょうど上限は通る" do
    sign_in_as users(:organizer)

    issue(byte_size: Question::IMAGE_MAX_BYTES + 1)
    expect(response).to have_http_status(:unprocessable_content)

    issue(byte_size: Question::IMAGE_MAX_BYTES)
    expect(response).to have_http_status(:success)
  end

  it "ログアウト後に控えた古い cookie では発行できない" do
    sign_in_as users(:organizer)
    old = cookies[Rails.application.config.session_options[:key]]
    delete session_path
    cookies[Rails.application.config.session_options[:key]] = old

    issue

    expect(response).to have_http_status(:unauthorized)
  end

  it "blob が文字列・配列・欠落でも 500 にならず 422" do
    sign_in_as users(:organizer)

    [ { blob: "abc" }, { blob: [ "x" ] }, {}, { blob: { content_type: "image/png" } } ].each do |payload|
      post rails_direct_uploads_path, params: payload, as: :json
      expect(response).to have_http_status(:unprocessable_content), payload.inspect
    end
  end

  it "filename と checksum が欠けていても 500 にならず 422" do
    sign_in_as users(:organizer)

    %i[filename checksum].each do |key|
      params = blob_params
      params[:blob].delete(key)
      post rails_direct_uploads_path, params: params, as: :json
      expect(response).to have_http_status(:unprocessable_content), key.to_s
    end
  end
end
