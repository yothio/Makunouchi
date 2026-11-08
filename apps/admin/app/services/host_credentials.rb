# live Worker と同じ PBKDF2: pbkdf2-sha256$<反復>$<salt b64>$<hash b64>
# （PBKDF2-HMAC-SHA256、導出鍵 32 バイト、salt 16 バイト、標準 Base64・パディングあり）。
# 反復 100000 は Workers の WebCrypto の PBKDF2 の上限。
module HostCredentials
  ITERATIONS = 100_000
  KEY_BYTES = 32
  SALT_BYTES = 16
  # 口頭で伝えやすいよう、紛らわしい文字（0 O 1 l I など）を除いた英小文字と数字。
  ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789".chars.freeze
  LOGIN_ID_LENGTH = 8
  PASSWORD_LENGTH = 12

  def self.generate
    password = random_string(PASSWORD_LENGTH)
    { login_id: random_string(LOGIN_ID_LENGTH), password: password, password_hash: hash_password(password) }
  end

  def self.hash_password(password, salt: SecureRandom.random_bytes(SALT_BYTES))
    key = OpenSSL::PKCS5.pbkdf2_hmac(password, salt, ITERATIONS, KEY_BYTES, "sha256")
    [ "pbkdf2-sha256", ITERATIONS, Base64.strict_encode64(salt), Base64.strict_encode64(key) ].join("$")
  end

  def self.random_string(length)
    Array.new(length) { ALPHABET[SecureRandom.random_number(ALPHABET.size)] }.join
  end
end
