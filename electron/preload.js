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

  // Mega folder links (second library source)
  addMegaLink: (url) => ipcRenderer.invoke('mega:addLink', url),
  removeMegaLink: (index) => ipcRenderer.invoke('mega:removeLink', index),
  getMegaStatus: (locator) => ipcRenderer.invoke('mega:cacheStatus', locator),
  onMegaProgress: (callback) => {
    const handler = (_event, data) => callback(data)
    ipcRenderer.on('mega:progress', handler)
    return () => ipcRenderer.removeListener('mega:progress', handler)
  },

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
  // Local files: served by the coursevault:// protocol in the main process.
  // Mega files (locator "mega://<linkIndex>/<handle>"): streamed from Mega
  // through the same protocol, in cached chunks (see electron/mega.js).
  mediaUrl: (filePath) => {
    if (typeof filePath === 'string' && filePath.startsWith('mega://')) {
      return 'coursevault://mega/' + filePath.slice('mega://'.length)
    }
    return 'coursevault://media/' + encodeURIComponent(filePath)
  }
})
