Rails.application.config.to_prepare do
  ActiveStorage::DirectUploadsController.include DirectUploadGuard
end
