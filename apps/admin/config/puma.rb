threads_count = ENV.fetch("RAILS_MAX_THREADS", 3)
threads threads_count, threads_count

# Cloud Run は PORT を渡してくる。無いときの既定は、本番だけ 8080、開発・テストは雛形どおり 3000。
port ENV.fetch("PORT") { ENV["RAILS_ENV"] == "production" ? 8080 : 3000 }

plugin :tmp_restart

pidfile ENV["PIDFILE"] if ENV["PIDFILE"]
