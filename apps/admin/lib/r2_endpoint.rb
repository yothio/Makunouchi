require "uri"

# R2 の S3 互換 endpoint はアカウントのオリジンだけにする。
# パスにバケット名を入れると Active Storage のオブジェクトキーが
# 「バケット名/blob.key」になり、公開 URL（R2_PUBLIC_BASE_URL/blob.key）とずれる。
module R2Endpoint
  class Invalid < StandardError; end

  def self.validate!(endpoint, production: Rails.env.production?)
    return unless production
    return if endpoint.blank?

    uri = URI.parse(endpoint)
    path = uri.path.to_s
    return if path.empty? || path == "/"

    raise Invalid,
          "R2_ENDPOINT にパスを含めない（バケット名は R2_BUCKET）。" \
          "ダッシュボードの S3 API の URL からバケット名を外す"
  rescue URI::InvalidURIError
    raise Invalid, "R2_ENDPOINT が URL として不正"
  end
end
