/**
 * CourseVault — renderer store.
 * Plain Vue 3 reactive state + the functions the views call.
 * All persistence goes through the Tauri bridge (src/lib/bridge.js);
 * nothing here touches the filesystem.
 */
import { reactive, computed } from 'vue'
import { bridge } from './lib/bridge.js'

export const store = reactive({
  libraryPath: null,
  courses: [],
  progress: {}, // lessonId -> { position, duration, completed, updatedAt }
  loading: true,
  searchQuery: '',
  searchResults: [],
  searching: false
})

export const totalLessons = computed(() =>
  store.courses.reduce(
    (n, c) => n + c.modules.reduce((m, mod) => m + mod.lessons.length, 0),
    0
  )
)

export const completedLessons = computed(
  () => Object.values(store.progress).filter((p) => p.completed).length
)

export function findLesson(lessonId) {
  for (const course of store.courses) {
    for (const mod of course.modules) {
      const lesson = mod.lessons.find((l) => l.id === lessonId)
      if (lesson) return { course, module: mod, lesson }
    }
  }
  return null
}

export function lessonProgress(lessonId) {
  return store.progress[lessonId] || { position: 0, duration: 0, completed: false }
}

export function courseProgress(course) {
  const lessons = course.modules.flatMap((m) => m.lessons)
  if (lessons.length === 0) return 0
  const sum = lessons.reduce((acc, l) => {
    const p = lessonProgress(l.id)
    if (p.completed) return acc + 1
    if (p.duration > 0) return acc + Math.min(p.position / p.duration, 1)
    return acc
  }, 0)
  return Math.round((sum / lessons.length) * 100)
}

export async function loadLibrary() {
  store.loading = true
  try {
    const state = await bridge.getState()
    store.progress = state.progress || {}
    const { libraryPath, courses } = await bridge.scanLibrary()
    store.libraryPath = libraryPath
    store.courses = courses
  } finally {
    store.loading = false
  }
}

export async function pickLibrary() {
  const picked = await bridge.pickLibrary()
  if (picked) await loadLibrary()
}

export async function clearLibrary() {
  await bridge.clearLibrary()
  store.libraryPath = null
  store.courses = []
}

let saveTimer = null
let lastWrite = 0

// Throttled disk write: write at most every 4s while a video plays, with a
// trailing write 800ms after the last update. A pure debounce never fires
// during continuous playback (timeupdate keeps resetting it), so progress
// would only reach disk when playback stopped.
export function saveProgress(lessonId, data) {
  store.progress[lessonId] = { ...lessonProgress(lessonId), ...data }
  const now = Date.now()
  if (now - lastWrite > 4000) {
    flushProgress(lessonId)
  } else {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => flushProgress(lessonId), 800)
  }
}

export function flushProgress(lessonId) {
  clearTimeout(saveTimer)
  lastWrite = Date.now()
  // Spread into a plain object: the stored value is a Vue reactive proxy,
  // and Electron's IPC uses structured clone, which cannot clone proxies —
  // passing the proxy throws "An object could not be cloned" and the
  // save silently never happens.
  bridge.saveProgress(lessonId, { ...store.progress[lessonId] })
}

export function markComplete(lessonId, completed = true) {
  saveProgress(lessonId, { completed })
  // Flush immediately for an explicit user action.
  flushProgress(lessonId)
}

export async function runSearch(query) {
  store.searchQuery = query
  if (!query.trim()) {
    store.searchResults = []
    return
  }
  store.searching = true
  try {
    store.searchResults = await bridge.search(query)
  } finally {
    store.searching = false
  }
}
