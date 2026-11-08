# QuizSession のスナップショットから、live の PUT /api/sessions/:id 用の Hash を組み立てる。
# points / topN は送らない。host は常に含め、平文パスワードは入れない。
class QuizPayloadBuilder
  class InsecureImageUrl < StandardError; end

  def self.call(session, strict_https: Rails.env.production?)
    new(session, strict_https: strict_https).call
  end

  def initialize(session, strict_https:)
    @session = session
    @strict_https = strict_https
  end

  def call
    {
      title: @session.title,
      questions: @session.quiz_snapshot.map { |question| question_payload(question) },
      host: {
        loginId: @session.host_login_id,
        passwordHash: @session.host_password_hash
      }
    }
  end

  private

  def question_payload(question)
    {
      title: question["title"],
      imageUrl: image_url_for(question["imageKey"]),
      choices: question["choices"],
      correctIndex: question["correctIndex"]
    }
  end

  def image_url_for(image_key)
    return nil if image_key.blank?

    base = ENV.fetch("R2_PUBLIC_BASE_URL", "").chomp("/")
    url = "#{base}/#{image_key}"
    if @strict_https && !url.start_with?("https://")
      raise InsecureImageUrl, "imageUrl must be https in production: #{url}"
    end
    url
  end
end

