<template>
  <div class="app">
    <header class="topbar">
      <a href="#/" class="brand">📚 CourseVault</a>
      <div class="search-box">
        <input
          v-model="query"
          type="search"
          placeholder="Search lessons, notes, subtitles…"
          @keyup.enter="goSearch"
        />
        <button class="btn btn-small" @click="goSearch">Search</button>
      </div>
      <div class="top-actions">
        <span v-if="store.libraryPath" class="library-path" :title="store.libraryPath">
          {{ shortPath(store.libraryPath) }}
        </span>
        <button class="btn btn-small btn-ghost" @click="pickLibrary">
          {{ store.libraryPath ? 'Change folder' : 'Choose folder' }}
        </button>
      </div>
    </header>

    <main>
      <LibraryView v-if="route.name === 'library'" />
      <CourseView v-else-if="route.name === 'course'" :course-id="route.param" />
      <LessonView v-else-if="route.name === 'lesson'" :lesson-id="route.param" />
      <SearchView v-else-if="route.name === 'search'" />
    </main>

    <footer class="foot">
      CourseVault v1 — your library lives on your PC. No accounts, no cloud, no AI.
    </footer>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import LibraryView from './components/LibraryView.vue'
import CourseView from './components/CourseView.vue'
import LessonView from './components/LessonView.vue'
import SearchView from './components/SearchView.vue'
import { store, loadLibrary, pickLibrary, runSearch } from './store.js'
import { bridge } from './lib/bridge.js'

const query = ref('')
const route = reactive({ name: 'library', param: '' })

function parseHash() {
  const hash = window.location.hash.replace(/^#\/?/, '')
  const [head, rawParam] = hash.split('/')
  const param = rawParam ? decodeURIComponent(rawParam) : ''
  if (head === 'course' && param) { route.name = 'course'; route.param = rawParam }
  else if (head === 'lesson' && param) { route.name = 'lesson'; route.param = rawParam }
  else if (head === 'search') { route.name = 'search'; route.param = '' }
  else { route.name = 'library'; route.param = '' }
}

function goSearch() {
  if (!query.value.trim()) return
  runSearch(query.value)
  window.location.hash = '#/search'
}

function shortPath(p) {
  const parts = p.split(/[/\\]/).filter(Boolean)
  if (parts.length <= 3) return p
  return '…/' + parts.slice(-2).join('/')
}

onMounted(async () => {
  window.addEventListener('hashchange', parseHash)
  parseHash()
  // Media server port first: lesson <video> URLs depend on it.
  await bridge.initMediaPort()
  await loadLibrary()
  // Re-scan automatically when files change in the library folder.
  bridge.onLibraryChanged(() => loadLibrary())
})
</script>

<style>
* { box-sizing: border-box; }
body {
  margin: 0;
  background: #0f172a;
  color: #f1f5f9;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}
code {
  background: #0f172a; border: 1px solid #334155; border-radius: 5px;
  padding: 1px 6px; font-size: 0.9em;
}
pre {
  background: #0f172a; border: 1px solid #334155; border-radius: 8px;
  padding: 14px; overflow-x: auto; font-size: 13px; line-height: 1.5;
}
pre code { background: none; border: none; padding: 0; }
.markdown h1, .markdown h2, .markdown h3, .markdown h4 { margin: 1.1em 0 0.5em; }
.markdown h1 { font-size: 22px; }
.markdown h2 { font-size: 18px; }
.markdown h3 { font-size: 16px; }
.markdown p { line-height: 1.65; }
.markdown ul { line-height: 1.6; padding-left: 22px; }
.markdown a { color: #7dd3fc; }
.btn {
  background: #334155; color: #f1f5f9; border: 1px solid #475569;
  border-radius: 8px; padding: 9px 16px; font-size: 14px; cursor: pointer;
}
.btn:hover { background: #475569; }
.btn-primary { background: #2563eb; border-color: #2563eb; }
.btn-primary:hover { background: #1d4ed8; }
.btn-ghost { background: transparent; }
.btn-small { padding: 6px 12px; font-size: 13px; }
.btn-done { background: #166534; border-color: #166534; }
</style>

<style scoped>
.app { min-height: 100vh; display: flex; flex-direction: column; }
.topbar {
  display: flex; align-items: center; gap: 16px;
  padding: 12px 24px; background: #1e293b; border-bottom: 1px solid #334155;
  position: sticky; top: 0; z-index: 10;
}
.brand { font-size: 19px; font-weight: 700; color: #f1f5f9; text-decoration: none; white-space: nowrap; }
.search-box { flex: 1; display: flex; gap: 8px; max-width: 520px; margin: 0 auto; }
.search-box input {
  flex: 1; background: #0f172a; border: 1px solid #334155; border-radius: 8px;
  color: #f1f5f9; padding: 8px 12px; font-size: 14px; outline: none;
}
.search-box input:focus { border-color: #2563eb; }
.top-actions { display: flex; align-items: center; gap: 10px; margin-left: auto; }
.library-path { font-size: 12px; color: #94a3b8; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
main { flex: 1; padding: 24px; }
.foot {
  text-align: center; color: #64748b; font-size: 12px; padding: 16px;
  border-top: 1px solid #1e293b;
}
@media (max-width: 800px) {
  .library-path { display: none; }
  .topbar { flex-wrap: wrap; }
}
</style>
