/**
 * CourseVault — Tauri bridge.
 * Same API shape the Electron preload exposed as `window.coursevault`,
 * implemented with Tauri 2 commands. The views and the store talk to this
 * module; nothing here touches the filesystem directly.
 */
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export const bridge = {
  // Library
  pickLibrary: () => invoke('pick_library'),
  scanLibrary: () => invoke('scan_library'),
  getState: () => invoke('get_state'),
  clearLibrary: () => invoke('clear_library'),
  onLibraryChanged: (callback) => listen('library-changed', callback),

  // Progress (resume positions, completion)
  saveProgress: (lessonId, data) => invoke('save_progress', { lessonId, data }),
  getAllProgress: () => invoke('get_progress'),

  // Lesson files
  getNote: (filePath) => invoke('get_note', { filePath }),
  getSubtitles: (filePath) => invoke('get_subtitles', { filePath }),
  openFile: (filePath) => invoke('open_file', { filePath }),

  // Search
  search: (query) => invoke('search_library', { query }),

  // Local media URL for the <video> element.
  // Lesson media is streamed by the loopback media server (Rust side,
  // http://127.0.0.1:<port>/<url-encoded path>, Range-capable so seeking
  // works). WebKitGTK's media pipeline cannot play `asset://` URLs on
  // Linux (MEDIA_ERR_SRC_NOT_SUPPORTED), so the server is the primary
  // route; convertFileSrc is the fallback if the server failed to start.
  mediaPort: null,
  initMediaPort: async function () {
    if (this.mediaPort == null) {
      this.mediaPort = await invoke('get_media_port')
    }
    return this.mediaPort
  },
  mediaUrl: function (filePath) {
    if (this.mediaPort) {
      return `http://127.0.0.1:${this.mediaPort}/${encodeURIComponent(filePath)}`
    }
    return convertFileSrc(filePath)
  }
}
