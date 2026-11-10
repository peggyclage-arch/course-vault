/**
 * CourseVault — Electron main process.
 *
 * Responsibilities:
 *  - Create the app window and load the Vue renderer.
 *  - Serve local media files over a custom `coursevault://` protocol
 *    (restricted to the library folder the user picked).
 *  - Scan the library folder into a courses > modules > lessons tree.
 *  - Persist progress / resume positions / last library folder as JSON
 *    in the app-data folder. No server, no cloud, no accounts.
 *  - Watch the library folder and tell the renderer to re-scan on change.
 */

const { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const chokidar = require('chokidar')

// The custom scheme must be registered as privileged BEFORE the app is
// ready, otherwise <video> and fetch() cannot use it: without
// `standard: true` the URL is treated as opaque and media fails to load
// (MEDIA_ERR_SRC_NOT_SUPPORTED), and without `stream: true` the media
// element cannot stream/seek through it.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'coursevault',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
  }
])

// ---------------------------------------------------------------------------
// Local state (JSON in the OS app-data folder)
// ---------------------------------------------------------------------------

const STATE_FILE = path.join(app.getPath('userData'), 'coursevault-state.json')

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  } catch {
    return { libraryPath: null, progress: {} }
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8')
}

let state = loadState()
let libraryRoot = state.libraryPath || null

// ---------------------------------------------------------------------------
// Library scanner
//
// Folder convention (see README.md):
//   Library/
//     <Course>/
//       course.md            (optional description)
//       <Module>/
//         01 - <Lesson>.mp4  (video, optional)
//         01 - <Lesson>.srt  (subtitles, optional; .vtt also works)
//         01 - <Lesson>.md   (notes, optional)
//         01 - <Lesson>/     (downloads / resources for that lesson)
// ---------------------------------------------------------------------------

const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.webm', '.mov'])
const SUB_EXTS = new Set(['.srt', '.vtt'])

/** "01 - Intro to X" -> { order: 1, title: "Intro to X" } */
function splitPrefix(name) {
  const m = name.match(/^(\d+)\s*[-_.]\s*(.+)$/)
  return m ? { order: parseInt(m[1], 10), title: m[2] } : { order: 9999, title: name }
}

function sortByPrefix(a, b) {
  return a.order - b.order || a.title.localeCompare(b.title)
}

function listFilesRecursive(dir, base = dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listFilesRecursive(full, base))
    else if (entry.isFile()) {
      out.push({
        name: path.relative(base, full).split(path.sep).join('/'),
        path: full,
        size: fs.statSync(full).size
      })
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Group the files directly inside one folder into lessons, by filename stem:
 * "01 - Intro.mp4" + "01 - Intro.md" + "01 - Intro.srt" = one lesson.
 * `excludeFiles` holds lowercase filenames to skip (e.g. course.md, the
 * course description file — it is not a lesson). Subfolders named like a
 * lesson stem hold that lesson's resources. A stem that is only a resources
 * folder (no video/note/subtitle) is not a lesson and is skipped.
 */
function buildLessonsFromDir(dirPath, moduleId, excludeFiles = new Set()) {
  const byStem = new Map()
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      // A folder named like a lesson stem holds that lesson's resources.
      const stem = entry.name
      if (!byStem.has(stem)) byStem.set(stem, { stem, resourcesDir: full })
      else byStem.get(stem).resourcesDir = full
      continue
    }
    if (excludeFiles.has(entry.name.toLowerCase())) continue
    const ext = path.extname(entry.name).toLowerCase()
    const stem = path.basename(entry.name, ext)
    if (!byStem.has(stem)) byStem.set(stem, { stem })
    const lesson = byStem.get(stem)
    if (VIDEO_EXTS.has(ext)) lesson.video = full
    else if (ext === '.md') lesson.note = full
    else if (SUB_EXTS.has(ext)) {
      lesson.subtitles = lesson.subtitles || []
      lesson.subtitles.push({ path: full, lang: ext === '.vtt' ? 'vtt' : 'srt' })
    }
    // Anything else loose in the folder is ignored.
  }

  const lessons = []
  for (const raw of byStem.values()) {
    const { order: lOrder, title: lTitle } = splitPrefix(raw.stem)
    const lesson = {
      id: `${moduleId}/${raw.stem}`,
      name: lTitle,
      order: lOrder,
      path: raw.stem,
      video: raw.video || null,
      note: raw.note || null,
      subtitles: raw.subtitles || [],
      resourcesDir: raw.resourcesDir || null,
      resources: raw.resourcesDir ? listFilesRecursive(raw.resourcesDir) : []
    }
    if (!lesson.video && !lesson.note && lesson.subtitles.length === 0) continue
    lessons.push(lesson)
  }
  lessons.sort(sortByPrefix)
  return lessons
}

/** Read a course.md file: first "# Heading" is the display title. */
function readCourseMd(courseMdPath, course) {
  if (!fs.existsSync(courseMdPath)) return
  const raw = fs.readFileSync(courseMdPath, 'utf8')
  const lines = raw.split('\n')
  if (lines[0].startsWith('# ')) {
    course.name = lines[0].replace(/^#\s+/, '').trim()
    course.description = lines.slice(1).join('\n').trim()
  } else {
    course.description = raw.trim()
  }
}

function scanLibrary(root) {
  const courses = []
  if (!root || !fs.existsSync(root)) return courses

  for (const courseEntry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!courseEntry.isDirectory() || courseEntry.name.startsWith('.')) continue
    const coursePath = path.join(root, courseEntry.name)
    const { order, title } = splitPrefix(courseEntry.name)
    const course = {
      id: courseEntry.name,
      name: title,
      order,
      path: coursePath,
      description: '',
      modules: []
    }

    readCourseMd(path.join(coursePath, 'course.md'), course)

    for (const modEntry of fs.readdirSync(coursePath, { withFileTypes: true })) {
      if (!modEntry.isDirectory() || modEntry.name.startsWith('.')) continue
      const modPath = path.join(coursePath, modEntry.name)
      const mod = splitPrefix(modEntry.name)
      const module = {
        id: `${course.id}/${modEntry.name}`,
        name: mod.title,
        order: mod.order,
        path: modPath,
        lessons: buildLessonsFromDir(modPath, `${course.id}/${modEntry.name}`)
      }
      if (module.lessons.length > 0) course.modules.push(module)
    }

    // Flatter layout: lesson files directly inside the course folder
    // (no module subfolders) become one "Lessons" module. course.md is
    // the course description, not a lesson, so it is excluded.
    const flatLessons = buildLessonsFromDir(
      coursePath,
      `${course.id}/Lessons`,
      new Set(['course.md'])
    )
    if (flatLessons.length > 0) {
      course.modules.push({
        id: `${course.id}/Lessons`,
        name: 'Lessons',
        order: 9999,
        path: coursePath,
        lessons: flatLessons
      })
    }

    course.modules.sort(sortByPrefix)
    if (course.modules.length > 0) courses.push(course)
  }

  // Flattest layout: lesson files directly inside the selected folder
  // (no course subfolders with content) — the folder itself is one course,
  // named after the folder, with a single "Lessons" module.
  const rootLessons = buildLessonsFromDir(root, `${path.basename(root)}/Lessons`, new Set(['course.md']))
  if (rootLessons.length > 0) {
    const rootCourse = {
      id: path.basename(root),
      name: splitPrefix(path.basename(root)).title,
      order: 9999,
      path: root,
      description: '',
      modules: [{
        id: `${path.basename(root)}/Lessons`,
        name: 'Lessons',
        order: 9999,
        path: root,
        lessons: rootLessons
      }]
    }
    readCourseMd(path.join(root, 'course.md'), rootCourse)
    courses.push(rootCourse)
  }

  courses.sort(sortByPrefix)
  return courses
}

// ---------------------------------------------------------------------------
// Search index — titles, notes and subtitle text, built at scan time.
// ---------------------------------------------------------------------------

let searchIndex = []

function stripSrtTimestamps(text) {
  return text
    .split('\n')
    .filter((line) => !/^\d+$/.test(line.trim()) && !/-->/.test(line) && line.trim() !== '')
    .join(' ')
}

function buildSearchIndex(courses) {
  searchIndex = []
  for (const course of courses) {
    for (const mod of course.modules) {
      for (const lesson of mod.lessons) {
        let haystack = `${course.name} ${mod.name} ${lesson.name}`
        if (lesson.note) {
          try { haystack += ' ' + fs.readFileSync(lesson.note, 'utf8') } catch { /* ignore */ }
        }
        for (const sub of lesson.subtitles) {
          try {
            const raw = fs.readFileSync(sub.path, 'utf8')
            haystack += ' ' + (sub.lang === 'srt' ? stripSrtTimestamps(raw) : raw)
          } catch { /* ignore */ }
        }
        searchIndex.push({ lessonId: lesson.id, course: course.name, module: mod.name, lesson: lesson.name, text: haystack })
      }
    }
  }
}

function searchLibrary(query) {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const words = q.split(/\s+/)
  return searchIndex
    .filter((entry) => {
      const hay = entry.text.toLowerCase()
      return words.every((w) => hay.includes(w))
    })
    .map((entry) => {
      const idx = entry.text.toLowerCase().indexOf(words[0])
      const start = Math.max(0, idx - 60)
      return {
        lessonId: entry.lessonId,
        course: entry.course,
        module: entry.module,
        lesson: entry.lesson,
        snippet: (start > 0 ? '…' : '') + entry.text.slice(start, start + 180).replace(/\s+/g, ' ').trim()
      }
    })
    .slice(0, 50)
}

// ---------------------------------------------------------------------------
// Subtitles: SRT -> WebVTT conversion (served to the player as a blob).
// ---------------------------------------------------------------------------

function srtToVtt(srt) {
  const body = srt
    .replace(/\r\n/g, '\n')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
  return 'WEBVTT\n\n' + body
}

// ---------------------------------------------------------------------------
// File protocol: coursevault://media/<url-encoded absolute path>
// Only files inside the chosen library folder are served.
// ---------------------------------------------------------------------------

function isInsideLibrary(filePath) {
  if (!libraryRoot) return false
  const rel = path.relative(libraryRoot, filePath)
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel)
}

function registerProtocol() {
  protocol.handle('coursevault', (request) => {
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'media') return new Response('Not found', { status: 404 })
      const filePath = decodeURIComponent(url.pathname.slice(1))
      if (!isInsideLibrary(filePath) || !fs.existsSync(filePath)) {
        return new Response('Not found', { status: 404 })
      }
      const ext = path.extname(filePath).toLowerCase()
      const mime = MIME[ext] || 'application/octet-stream'
      const size = fs.statSync(filePath).size

      // The <video> element seeks with HTTP Range requests. net.fetch()
      // does not forward the incoming Range header, so a plain fetch
      // breaks seeking (the player snaps back to 0). Answer ranges
      // ourselves and stream everything else through net.fetch().
      const range = request.headers.get('range')
      if (range) {
        const m = /bytes=(\d+)-(\d*)/.exec(range)
        if (m) {
          const start = parseInt(m[1], 10)
          const end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1
          if (start >= size) {
            return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
          }
          const fd = fs.openSync(filePath, 'r')
          const buf = Buffer.alloc(end - start + 1)
          fs.readSync(fd, buf, 0, buf.length, start)
          fs.closeSync(fd)
          return new Response(buf, {
            status: 206,
            headers: {
              'Content-Type': mime,
              'Content-Length': String(buf.length),
              'Content-Range': `bytes ${start}-${end}/${size}`,
              'Accept-Ranges': 'bytes'
            }
          })
        }
      }
      // No range: stream the whole file (net.fetch handles this well).
      return net.fetch('file://' + filePath)
    } catch {
      return new Response('Bad request', { status: 400 })
    }
  })
}

const MIME = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.vtt': 'text/vtt',
  '.srt': 'text/plain'
}

// ---------------------------------------------------------------------------
// Folder watcher — re-scan when the library changes.
// ---------------------------------------------------------------------------

let watcher = null
let watchTimer = null

function watchLibrary(win) {
  if (watcher) watcher.close()
  watcher = null
  if (!libraryRoot || !fs.existsSync(libraryRoot)) return
  watcher = chokidar.watch(libraryRoot, { ignoreInitial: true, depth: 4 })
  const notify = () => {
    clearTimeout(watchTimer)
    watchTimer = setTimeout(() => {
      if (!win.isDestroyed()) win.webContents.send('library:changed')
    }, 600)
  }
  watcher.on('add', notify)
  watcher.on('unlink', notify)
  watcher.on('addDir', notify)
  watcher.on('unlinkDir', notify)
  watcher.on('change', notify)
}

// ---------------------------------------------------------------------------
// Window + IPC
// ---------------------------------------------------------------------------

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'CourseVault',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  return win
}

app.whenReady().then(() => {
  registerProtocol()
  const win = createWindow()
  watchLibrary(win)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const w = createWindow()
      watchLibrary(w)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// --- Library ---------------------------------------------------------------

ipcMain.handle('library:pick', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  if (result.canceled || result.filePaths.length === 0) return null
  libraryRoot = result.filePaths[0]
  state.libraryPath = libraryRoot
  saveState(state)
  const win = BrowserWindow.getFocusedWindow()
  if (win) watchLibrary(win)
  return libraryRoot
})

ipcMain.handle('library:scan', async () => {
  const courses = scanLibrary(libraryRoot)
  buildSearchIndex(courses)
  return { libraryPath: libraryRoot, courses }
})

ipcMain.handle('library:getState', async () => state)

ipcMain.handle('library:clear', async () => {
  libraryRoot = null
  state.libraryPath = null
  saveState(state)
  if (watcher) { watcher.close(); watcher = null }
  return true
})

// --- Progress --------------------------------------------------------------

ipcMain.handle('progress:save', async (_event, lessonId, data) => {
  state.progress[lessonId] = { ...state.progress[lessonId], ...data, updatedAt: Date.now() }
  saveState(state)
  return true
})

ipcMain.handle('progress:getAll', async () => state.progress)

// --- Lesson files ----------------------------------------------------------

ipcMain.handle('lesson:getNote', async (_event, filePath) => {
  if (!isInsideLibrary(filePath) || !fs.existsSync(filePath)) return null
  return fs.readFileSync(filePath, 'utf8')
})

ipcMain.handle('lesson:getSubtitles', async (_event, filePath) => {
  if (!isInsideLibrary(filePath) || !fs.existsSync(filePath)) return null
  const raw = fs.readFileSync(filePath, 'utf8')
  const ext = path.extname(filePath).toLowerCase()
  return ext === '.srt' ? srtToVtt(raw) : raw
})

ipcMain.handle('file:open', async (_event, filePath) => {
  if (!isInsideLibrary(filePath) || !fs.existsSync(filePath)) return false
  await shell.openPath(filePath)
  return true
})

// --- Search ----------------------------------------------------------------

ipcMain.handle('search:query', async (_event, query) => searchLibrary(query))
