require "rack"

# Cloud Run の既定ドメイン（*.run.app）は監視用に残し、利用者のアクセスは独自ドメインに寄せる。
# リダイレクト先は引数のホストだけから作り、リクエストの Host や X-Forwarded-Host は使わない。
class CanonicalHostRedirect
  HEALTHCHECK_PATH = "/up".freeze
  RUN_APP_SUFFIX = ".run.app".freeze
  HOSTNAME_PATTERN = /\A[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+\z/

  def initialize(app, canonical_host)
    @app = app
    @canonical_host = canonical_host.to_s.strip.downcase
    return if HOSTNAME_PATTERN.match?(@canonical_host)

    raise ArgumentError, "独自ドメインはホスト名だけを指定する（スキームやパスは含めない）"
  end

  def call(env)
    return @app.call(env) unless restricted?(env)

    if %w[GET HEAD].include?(env["REQUEST_METHOD"])
      redirect(env)
    else
      forbidden
    end
  end

  private

  # Cloud Run の probe は Host が run.app でも独自ドメインでもないため、run.app だけを対象にする。
  def restricted?(env)
    run_app_host?(env["HTTP_HOST"]) && env["PATH_INFO"] != HEALTHCHECK_PATH
  end

  def run_app_host?(http_host)
    host = http_host.to_s.downcase.sub(/:\d+\z/, "").delete_suffix(".")
    host.end_with?(RUN_APP_SUFFIX)
  end

  def redirect(env)
    location = "https://#{@canonical_host}#{Rack::Request.new(env).fullpath}"
    [ 302, { "location" => location, "content-type" => "text/plain; charset=utf-8" }, [ "" ] ]
  end

  def forbidden
    [ 403, { "content-type" => "text/plain; charset=utf-8" }, [ "Forbidden" ] ]
  end
end
