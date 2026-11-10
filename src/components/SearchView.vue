<template>
  <div class="search-view">
    <h1>Search results for “{{ store.searchQuery }}”</h1>
    <div v-if="store.searching" class="center">Searching…</div>
    <div v-else-if="store.searchResults.length === 0" class="center">
      No matches. Search covers lesson titles, notes and subtitle text.
    </div>
    <ul v-else class="results">
      <li v-for="r in store.searchResults" :key="r.lessonId">
        <a :href="'#/lesson/' + encodeURIComponent(r.lessonId)">
          <span class="result-title">{{ r.lesson }}</span>
          <span class="result-crumb">{{ r.course }} · {{ r.module }}</span>
          <span class="result-snippet">{{ r.snippet }}</span>
        </a>
      </li>
    </ul>
  </div>
</template>

<script setup>
import { store } from '../store.js'
</script>

<style scoped>
.search-view { max-width: 880px; margin: 0 auto; padding: 8px 0 48px; }
.search-view h1 { font-size: 24px; }
.center { color: #94a3b8; padding: 32px 0; }
.results { list-style: none; padding: 0; }
.results li { margin-bottom: 10px; }
.results a {
  display: block; background: #1e293b; border: 1px solid #334155;
  border-radius: 10px; padding: 14px 16px; text-decoration: none; color: inherit;
}
.results a:hover { border-color: #64748b; }
.result-title { display: block; font-weight: 600; font-size: 15px; }
.result-crumb { display: block; color: #94a3b8; font-size: 13px; margin: 2px 0 6px; }
.result-snippet { display: block; color: #cbd5e1; font-size: 14px; line-height: 1.5; }
</style>
