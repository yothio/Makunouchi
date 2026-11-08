require "rails_helper"

RSpec.describe HostCredentials do
  # Python の hashlib.pbkdf2_hmac('sha256', b'correct horse', bytes(range(16)), 100000, 32) で独立に求めた値。
  # Task 6 の Worker（WebCrypto PBKDF2）も同じベクタで照合を固定する。
  let(:salt) { (0..15).to_a.pack("C*") }
  let(:vector) { "pbkdf2-sha256$100000$AAECAwQFBgcICQoLDA0ODw==$V/LC8HOXSNUWQZsGKohGZjI8WD6krhZVBKgfe1PGKgk=" }

  it "PBKDF2 のハッシュが固定ベクタと一致する" do
    expect(HostCredentials.hash_password("correct horse", salt: salt)).to eq vector
  end

  it "ハッシュの形式: 接頭辞・反復 100000・salt 16 バイト・導出鍵 32 バイト・標準 Base64（パディングあり）" do
    prefix, iterations, salt, hash = HostCredentials.hash_password("pw").split("$")

    expect(prefix).to eq "pbkdf2-sha256"
    expect(iterations).to eq "100000"
    expect(Base64.strict_decode64(salt).bytesize).to eq 16
    expect(Base64.strict_decode64(hash).bytesize).to eq 32
    expect(hash).to match(/\A[A-Za-z0-9+\/]+={0,2}\z/)
  end

  it "同じパスワードでも salt が違うのでハッシュは毎回違う" do
    expect(HostCredentials.hash_password("pw")).not_to eq HostCredentials.hash_password("pw")
  end

  it "generate は読み上げやすい 8 文字の ID と 12 文字のパスワードと、そのハッシュを返す" do
    credentials = HostCredentials.generate

    expect(credentials[:login_id]).to match(/\A[a-z2-9]{8}\z/)
    expect(credentials[:password]).to match(/\A[a-z2-9]{12}\z/)
    expect(credentials[:login_id] + credentials[:password]).not_to match(/[0O1lIio]/)
    expect(credentials[:password_hash]).to match(/\Apbkdf2-sha256\$100000\$/)
  end

  it "generate のハッシュはそのパスワードから作られている" do
    credentials = HostCredentials.generate
    salt = Base64.strict_decode64(credentials[:password_hash].split("$")[2])

    expect(HostCredentials.hash_password(credentials[:password], salt: salt)).to eq credentials[:password_hash]
  end

  it "generate は毎回違う値を返す" do
    expect(HostCredentials.generate[:password]).not_to eq HostCredentials.generate[:password]
  end
end
