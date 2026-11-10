/**
 * CourseVault — preload bridge.
 * The renderer never touches Node or the filesystem directly; everything
 * goes through this small, explicit API over IPC.
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('coursevault', {
  // Library
  pickLibrary: () => ipcRenderer.invoke('library:pick'),
  scanLibrary: () => ipcRenderer.invoke('library:scan'),
  getState: () => ipcRenderer.invoke('library:getState'),
  clearLibrary: () => ipcRenderer.invoke('library:clear'),
  onLibraryChanged: (callback) => ipcRenderer.on('library:changed', callback),

  // Progress (resume positions, completion)
  saveProgress: (lessonId, data) => ipcRenderer.invoke('progress:save', lessonId, data),
  getAllProgress: () => ipcRenderer.invoke('progress:getAll'),

  // Lesson files
  getNote: (filePath) => ipcRenderer.invoke('lesson:getNote', filePath),
  getSubtitles: (filePath) => ipcRenderer.invoke('lesson:getSubtitles', filePath),
  openFile: (filePath) => ipcRenderer.invoke('file:open', filePath),

  // Search
  search: (query) => ipcRenderer.invoke('search:query', query),

  // Local media URL for the <video> element.
  // Served by the coursevault:// protocol in the main process.
  mediaUrl: (filePath) => 'coursevault://media/' + encodeURIComponent(filePath)
})
