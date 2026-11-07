# syntax=docker/dockerfile:1
# check=error=true

# Cloud Run 向け。PORT（既定 8080）で待ち受ける。手元で試すとき:
# docker build -t admin .
# docker run -d -p 8080:8080 -e RAILS_MASTER_KEY=<value from config/master.key> -e DATABASE_URL=... \
#   -e R2_BUCKET=... -e R2_ENDPOINT=... -e R2_ACCESS_KEY_ID=... -e R2_SECRET_ACCESS_KEY=... --name admin admin

# For a containerized dev environment, see Dev Containers: https://guides.rubyonrails.org/getting_started_with_devcontainer.html

# Make sure RUBY_VERSION matches the Ruby version in .ruby-version
ARG RUBY_VERSION=4.0.6
FROM docker.io/library/ruby:$RUBY_VERSION-slim AS base

# Rails app lives here
WORKDIR /rails

# Install base packages
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y curl libjemalloc2 libvips libpq5 && \
    ln -s /usr/lib/$(uname -m)-linux-gnu/libjemalloc.so.2 /usr/local/lib/libjemalloc.so && \
    rm -rf /var/lib/apt/lists /var/cache/apt/archives

# Set production environment variables and enable jemalloc for reduced memory usage and latency.
ENV RAILS_ENV="production" \
    BUNDLE_DEPLOYMENT="1" \
    BUNDLE_PATH="/usr/local/bundle" \
    BUNDLE_WITHOUT="development" \
    PORT="8080" \
    LD_PRELOAD="/usr/local/lib/libjemalloc.so"

# Throw-away build stage to reduce size of final image
FROM base AS build

# Install packages needed to build gems
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential git libpq-dev libvips libyaml-dev pkg-config && \
    rm -rf /var/lib/apt/lists /var/cache/apt/archives

# Install application gems
COPY vendor/* ./vendor/
COPY Gemfile Gemfile.lock ./

RUN bundle install && \
    rm -rf ~/.bundle/ "${BUNDLE_PATH}"/ruby/*/cache "${BUNDLE_PATH}"/ruby/*/bundler/gems/*/.git && \
    # -j 1 disable parallel compilation to avoid a QEMU bug: https://github.com/rails/bootsnap/issues/495
    bundle exec bootsnap precompile -j 1 --gemfile

# Copy application code
COPY . .

# Precompile bootsnap code for faster boot times.
# -j 1 disable parallel compilation to avoid a QEMU bug: https://github.com/rails/bootsnap/issues/495
RUN bundle exec bootsnap precompile -j 1 app/ lib/

# Precompiling assets for production without requiring secret RAILS_MASTER_KEY.
# R2_* は本番の起動時に必須（storage.yml の r2）。ビルド中だけダミーを渡す（ENV ではないのでイメージには残らない）。
RUN SECRET_KEY_BASE_DUMMY=1 R2_BUCKET=build-dummy R2_ENDPOINT=https://build-dummy.invalid R2_ACCESS_KEY_ID=build-dummy R2_SECRET_ACCESS_KEY=build-dummy ./bin/rails assets:precompile




# Final stage for app image
FROM base

# Run and own only the runtime files as a non-root user for security
RUN groupadd --system --gid 1000 rails && \
    useradd rails --uid 1000 --gid 1000 --create-home --shell /bin/bash
USER 1000:1000

# Copy built artifacts: gems, application
COPY --chown=rails:rails --from=build "${BUNDLE_PATH}" "${BUNDLE_PATH}"
COPY --chown=rails:rails --from=build /rails /rails

# Entrypoint（マイグレーションは流さない。README 参照）
ENTRYPOINT ["/rails/bin/docker-entrypoint"]

# PORT（Cloud Run が渡す。無ければ 8080）で待ち受ける。マイグレーションは起動時に流さない（README 参照）
EXPOSE 8080
CMD ["./bin/rails", "server"]
