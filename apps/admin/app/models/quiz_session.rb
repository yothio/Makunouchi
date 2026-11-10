class QuizSession < ApplicationRecord
  include LiveRegistration

  QUESTION_COUNT = (5..15) # live の制約（payload.ts）。開催回の作成時に検証する。

  belongs_to :user

  enum :status, { pending: "pending", ready: "ready", host_missing: "host_missing" }, validate: true

  # 幹事のパスワードは、開催回の詳細にいつでも表示するため暗号化して保存する。
  encrypts :host_password

  # 作成後は変えない。再試行（live への再 PUT）でも同じ値を送るため。
  attr_readonly :public_id, :quiz_snapshot, :host_login_id, :host_password, :host_password_hash

  normalizes :title, with: ->(value) { value.strip }

  validates :title, length: { in: 1..100 }
  validates :public_id, format: { with: /\A[A-Za-z0-9_-]{1,100}\z/ }, uniqueness: true
  validate :question_count_in_range

  def self.prepare(user:, title:)
    credentials = HostCredentials.generate
    new(
      user: user,
      title: title,
      public_id: SecureRandom.uuid,
      quiz_snapshot: snapshot_of(user.questions),
      host_login_id: credentials[:login_id],
      host_password: credentials[:password],
      host_password_hash: credentials[:password_hash]
    )
  end

  def self.snapshot_of(questions)
    questions.map do |question|
      {
        "title" => question.title,
        "choices" => question.choices,
        "correctIndex" => question.correct_index,
        "imageKey" => (question.image.blob.key if question.image.attached?)
      }
    end
  end

  def guest_url = "#{live_public_url}/s/#{public_id}"

  def host_url = "#{live_public_url}/host/#{public_id}"

  # 投影画面の URL。トークンは HMAC-SHA256(ADMIN_API_SECRET, "screen:" + public_id)。
  # ADMIN_API_SECRET が未設定なら nil（トークンを作れないので URL を出さない）。
  def screen_url
    secret = ENV["ADMIN_API_SECRET"].to_s
    return if secret.empty?

    "#{live_public_url}/screen/#{public_id}?token=#{Live::ScreenToken.screen(secret, public_id)}"
  end

  private

  def live_public_url
    ENV.fetch("LIVE_PUBLIC_URL", "").chomp("/")
  end

  def question_count_in_range
    count = quiz_snapshot&.size.to_i
    return if QUESTION_COUNT.cover?(count)

    errors.add(:base, :question_count_out_of_range,
               min: QUESTION_COUNT.min, max: QUESTION_COUNT.max, count: count)
  end
end
