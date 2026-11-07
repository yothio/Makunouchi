# ActiveStorage::DirectUploadsController は ApplicationController を継承しないので、
# そのままでは認証を通らず、誰でも R2 への書き込み用 URL を発行できてしまう。
# ログイン済みのユーザー（主催者またはシステム管理者）だけに絞り、発行前に
# content_type とサイズを検査する（クライアントの自己申告なので、添付後のモデル検証だけに頼らない）。
module DirectUploadGuard
  extend ActiveSupport::Concern

  included do
    before_action :require_logged_in_user
    before_action :require_acceptable_blob, only: :create
  end

  private

  def require_logged_in_user
    head :unauthorized unless Authentication.user_from(session)
  end

  def require_acceptable_blob
    blob = params[:blob]
    content_type = blob.respond_to?(:[]) ? blob[:content_type].to_s : ""
    byte_size = blob.respond_to?(:[]) ? blob[:byte_size].to_s : ""

    unless Question::IMAGE_CONTENT_TYPES.include?(content_type) && byte_size.match?(/\A\d+\z/) && byte_size.to_i <= Question::IMAGE_MAX_BYTES
      render json: { error: "画像（png / jpeg / webp / gif、#{Question::IMAGE_MAX_BYTES / 1.megabyte} MB 以下）だけアップロードできます。" },
             status: :unprocessable_entity
    end
  end
end
