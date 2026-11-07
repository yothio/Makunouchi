require "test_helper"

class HostCredentialsTest < ActiveSupport::TestCase
  # Python の hashlib.pbkdf2_hmac('sha256', b'correct horse', bytes(range(16)), 100000, 32) で独立に求めた値。
  # Task 6 の Worker（WebCrypto PBKDF2）も同じベクタで照合を固定する。
  SALT = (0..15).to_a.pack("C*")
  VECTOR = "pbkdf2-sha256$100000$AAECAwQFBgcICQoLDA0ODw==$V/LC8HOXSNUWQZsGKohGZjI8WD6krhZVBKgfe1PGKgk=".freeze

  test "PBKDF2 のハッシュが固定ベクタと一致する" do
    assert_equal VECTOR, HostCredentials.hash_password("correct horse", salt: SALT)
  end

  test "ハッシュの形式: 接頭辞・反復 100000・salt 16 バイト・導出鍵 32 バイト・標準 Base64（パディングあり）" do
    prefix, iterations, salt, hash = HostCredentials.hash_password("pw").split("$")

    assert_equal "pbkdf2-sha256", prefix
    assert_equal "100000", iterations
    assert_equal 16, Base64.strict_decode64(salt).bytesize
    assert_equal 32, Base64.strict_decode64(hash).bytesize
    assert_match(/\A[A-Za-z0-9+\/]+={0,2}\z/, hash)
  end

  test "同じパスワードでも salt が違うのでハッシュは毎回違う" do
    assert_not_equal HostCredentials.hash_password("pw"), HostCredentials.hash_password("pw")
  end

  test "generate は読み上げやすい 8 文字の ID と 12 文字のパスワードと、そのハッシュを返す" do
    credentials = HostCredentials.generate

    assert_match(/\A[a-z2-9]{8}\z/, credentials[:login_id])
    assert_match(/\A[a-z2-9]{12}\z/, credentials[:password])
    assert_no_match(/[0O1lIio]/, credentials[:login_id] + credentials[:password])
    assert_match(/\Apbkdf2-sha256\$100000\$/, credentials[:password_hash])
  end

  test "generate のハッシュはそのパスワードから作られている" do
    credentials = HostCredentials.generate
    salt = Base64.strict_decode64(credentials[:password_hash].split("$")[2])

    assert_equal credentials[:password_hash], HostCredentials.hash_password(credentials[:password], salt: salt)
  end

  test "generate は毎回違う値を返す" do
    assert_not_equal HostCredentials.generate[:password], HostCredentials.generate[:password]
  end
end
