import { Controller } from "@hotwired/stimulus"

// 選んだ画像のプレビューと、direct upload（R2 への直接 PUT）の進捗表示。
export default class extends Controller {
  static targets = ["input", "preview", "status"]

  show() {
    const file = this.inputTarget.files[0]
    if (!file) return
    this.previewTarget.src = URL.createObjectURL(file)
    this.previewTarget.hidden = false
    this.statusTarget.textContent = ""
  }

  progress(event) {
    this.statusTarget.textContent = `アップロード中… ${Math.round(event.detail.progress)}%`
  }

  failed(event) {
    event.preventDefault()
    this.statusTarget.textContent = "アップロードに失敗しました。もう一度選んでください。"
  }
}
