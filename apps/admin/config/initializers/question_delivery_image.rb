# 原画の attach はレコード属性を変えずに完了することがあるため、
# Question の after_commit だけではジョブを積めない。Attachment 作成を拾う。
ActiveSupport.on_load(:active_storage_attachment) do
  after_create_commit :enqueue_question_delivery_image

  def enqueue_question_delivery_image
    return unless record.is_a?(Question) && name == "image"

    record.enqueue_delivery_image_generation
  end
end
