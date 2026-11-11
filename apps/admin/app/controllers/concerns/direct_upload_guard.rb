# DirectUploadsController は認証が無いので、この Concern でログイン必須にする。
# 発行前に content_type/サイズを検査（自己申告のみではモデル検証が遅い）。
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
    # blob が文字列・配列・欠落でも、filename / checksum が無くても、Rails 本体が 500 を出す前に 422 にする。
    return render_unacceptable unless blob.is_a?(ActionController::Parameters)
    return render_unacceptable unless blob[:filename].is_a?(String) && blob[:filename].present?
    return render_unacceptable unless blob[:checksum].is_a?(String) && blob[:checksum].present?

    content_type = blob[:content_type].to_s
    byte_size = blob[:byte_size].to_s
    return render_unacceptable unless Question::IMAGE_CONTENT_TYPES.include?(content_type)
    render_unacceptable unless byte_size.match?(/\A\d+\z/) && byte_size.to_i <= Question::IMAGE_MAX_BYTES
  end

  def render_unacceptable
    render json: { error: t("direct_uploads.unacceptable", max_mb: Question::IMAGE_MAX_BYTES / 1.megabyte) },
           status: :unprocessable_entity
  end
end
