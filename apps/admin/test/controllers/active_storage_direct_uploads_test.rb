require "test_helper"

class ActiveStorageDirectUploadsTest < ActionDispatch::IntegrationTest
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

  test "未ログインは 401 で、presigned URL を発行しない" do
    assert_no_difference "ActiveStorage::Blob.count" do
      issue
    end

    assert_response :unauthorized
  end

  test "ログイン済みの主催者は発行できる" do
    sign_in_as users(:organizer)

    assert_difference "ActiveStorage::Blob.count", 1 do
      issue
    end

    assert_response :success
    assert_predicate response.parsed_body["direct_upload"]["url"], :present?
  end

  test "システム管理者も発行できる（主催者用の画面に入れる決定と揃える）" do
    sign_in_as users(:system_admin)

    issue

    assert_response :success
  end

  test "許可しない content_type は 422" do
    sign_in_as users(:organizer)

    assert_no_difference "ActiveStorage::Blob.count" do
      issue(content_type: "text/html")
    end
    assert_response :unprocessable_entity
  end

  test "許可する 4 種類は通る" do
    sign_in_as users(:organizer)

    %w[image/png image/jpeg image/webp image/gif].each do |type|
      issue(content_type: type)
      assert_response :success, type
    end
  end

  test "上限を超えるサイズは 422、ちょうど上限は通る" do
    sign_in_as users(:organizer)

    issue(byte_size: Question::IMAGE_MAX_BYTES + 1)
    assert_response :unprocessable_entity

    issue(byte_size: Question::IMAGE_MAX_BYTES)
    assert_response :success
  end

  test "ログアウト後に控えた古い cookie では発行できない" do
    sign_in_as users(:organizer)
    old = cookies[Rails.application.config.session_options[:key]]
    delete session_path
    cookies[Rails.application.config.session_options[:key]] = old

    issue

    assert_response :unauthorized
  end

  test "blob が文字列・配列・欠落でも 500 にならず 422" do
    sign_in_as users(:organizer)

    [ { blob: "abc" }, { blob: [ "x" ] }, {}, { blob: { content_type: "image/png" } } ].each do |payload|
      post rails_direct_uploads_path, params: payload, as: :json
      assert_response :unprocessable_entity, payload.inspect
    end
  end

  test "filename と checksum が欠けていても 500 にならず 422" do
    sign_in_as users(:organizer)

    %i[filename checksum].each do |key|
      params = blob_params
      params[:blob].delete(key)
      post rails_direct_uploads_path, params: params, as: :json
      assert_response :unprocessable_entity, key.to_s
    end
  end
end
