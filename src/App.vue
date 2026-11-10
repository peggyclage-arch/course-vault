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
        <span v-for="(link, i) in store.megaLinks" :key="link.url" class="mega-chip" :title="link.url">
          ☁️ {{ link.name || 'Mega folder' }}
          <button class="chip-x" @click="removeLink(i)" title="Remove this Mega link">×</button>
        </span>
        <button class="btn btn-small btn-ghost" @click="pickLibrary">
          {{ store.libraryPath ? 'Change folder' : 'Choose folder' }}
        </button>
        <button class="btn btn-small" @click="showMegaForm = true">Add Mega link</button>
      </div>
    </header>

    <div v-if="showMegaForm" class="mega-form">
      <form @submit.prevent="submitMegaLink">
        <label for="mega-url">Mega folder link</label>
        <input
          id="mega-url"
          v-model="megaUrl"
          type="url"
          placeholder="https://mega.nz/folder/…#…"
          :disabled="megaAdding"
        />
        <button class="btn btn-primary btn-small" type="submit" :disabled="megaAdding">
          {{ megaAdding ? 'Reading folder…' : 'Add link' }}
        </button>
        <button class="btn btn-small btn-ghost" type="button" @click="showMegaForm = false">Cancel</button>
      </form>
      <p v-if="megaError" class="mega-error">{{ megaError }}</p>
      <p v-else class="mega-hint">The folder is listed and streamed from Mega — no Mega account needed, the key is in the link. Videos play while they download; what you watch is cached on this PC.</p>
    </div>

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
import { store, loadLibrary, pickLibrary, runSearch, addMegaLink, removeMegaLink } from './store.js'

const query = ref('')
const route = reactive({ name: 'library', param: '' })
const showMegaForm = ref(false)
const megaUrl = ref('')
const megaError = ref('')
const megaAdding = ref(false)

async function submitMegaLink() {
  megaError.value = ''
  const url = megaUrl.value.trim()
  if (!url) { megaError.value = 'Paste a Mega folder link first.'; return }
  megaAdding.value = true
  try {
    const result = await addMegaLink(url)
    if (result.ok) {
      showMegaForm.value = false
      megaUrl.value = ''
    } else {
      megaError.value = result.error || 'Could not read that Mega folder.'
    }
  } finally {
    megaAdding.value = false
  }
}

async function removeLink(index) {
  await removeMegaLink(index)
}

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
  await loadLibrary()
  // Re-scan automatically when files change in the library folder.
  window.coursevault.onLibraryChanged(() => loadLibrary())
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
.mega-chip {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12px; color: #bae6fd; background: #0c4a6e;
  border: 1px solid #075985; border-radius: 999px; padding: 4px 6px 4px 10px;
  max-width: 240px; overflow: hidden; white-space: nowrap;
}
.chip-x {
  background: none; border: none; color: #bae6fd; cursor: pointer;
  font-size: 14px; line-height: 1; padding: 0 2px;
}
.chip-x:hover { color: #fff; }
.mega-form {
  background: #1e293b; border-bottom: 1px solid #334155; padding: 14px 24px;
}
.mega-form form { display: flex; align-items: center; gap: 10px; max-width: 1080px; margin: 0 auto; }
.mega-form label { font-size: 13px; color: #cbd5e1; white-space: nowrap; }
.mega-form input {
  flex: 1; background: #0f172a; border: 1px solid #334155; border-radius: 8px;
  color: #f1f5f9; padding: 8px 12px; font-size: 14px; outline: none;
}
.mega-form input:focus { border-color: #2563eb; }
.mega-error { color: #fca5a5; font-size: 13px; max-width: 1080px; margin: 8px auto 0; }
.mega-hint { color: #94a3b8; font-size: 13px; max-width: 1080px; margin: 8px auto 0; }
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
