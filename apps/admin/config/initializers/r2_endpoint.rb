require Rails.root.join("lib/r2_endpoint")

R2Endpoint.validate!(ENV["R2_ENDPOINT"])
