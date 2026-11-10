<template>
  <div class="lesson-view">
    <div v-if="!lesson" class="center">Lesson not found. <a href="#/">Back to library</a></div>

    <div v-else>
    <button class="btn btn-ghost back" @click="goBack">← {{ course.name }}</button>

    <div class="lesson-head">
      <div>
        <p class="crumb">{{ course.name }} · {{ module.name }}</p>
        <h1>{{ lesson.name }}</h1>
      </div>
      <button
        class="btn"
        :class="progress.completed ? 'btn-done' : ''"
        @click="toggleComplete"
      >
        {{ progress.completed ? '✓ Completed' : 'Mark as complete' }}
      </button>
    </div>

    <VideoPlayer v-if="lesson.video" :lesson="lesson" />
    <div v-else class="no-video">
      <p class="no-video-title">No video file for this lesson.</p>
      <p>Add a <code>{{ lesson.path }}.mp4</code> next to the notes and it will play here.</p>
    </div>

    <div v-if="lesson.subtitles.length" class="meta-line">
      Subtitles: {{ lesson.subtitles.map(s => s.path.split('/').pop()).join(', ') }}
    </div>

    <div class="lesson-body">
      <section v-if="noteHtml" class="notes">
        <h2>Notes</h2>
        <div class="markdown" v-html="noteHtml"></div>
      </section>
      <section v-else class="notes notes-empty">
        <h2>Notes</h2>
        <p>No notes for this lesson yet. Add a <code>{{ lesson.path }}.md</code> file next to the video.</p>
      </section>

      <aside class="side">
        <section v-if="lesson.resources.length" class="resources">
          <h2>Downloads &amp; resources</h2>
          <ul>
            <li v-for="file in lesson.resources" :key="file.path">
              <button class="resource-link" @click="openFile(file.path)">
                {{ file.name }} <span class="size">({{ formatBytes(file.size) }})</span>
              </button>
            </li>
          </ul>
          <p class="hint">Files open in their default app. Add files to the
            <code>{{ lesson.path }}/</code> folder to attach them here.</p>
        </section>

        <section class="up-next">
          <h2>Up next</h2>
          <ul>
            <li v-for="next in nextLessons" :key="next.id">
              <a :href="'#/lesson/' + encodeURIComponent(next.id)">
                {{ next.name }}
                <span v-if="lessonProgress(next.id).completed" class="done-mark">✓</span>
              </a>
            </li>
          </ul>
          <p v-if="nextLessons.length === 0" class="hint">This is the last lesson of the course.</p>
        </section>
      </aside>
    </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import VideoPlayer from './VideoPlayer.vue'
import { findLesson, lessonProgress, markComplete, store } from '../store.js'
import { renderMarkdown } from '../lib/markdown.js'
import { bridge } from '../lib/bridge.js'
import { formatBytes } from '../lib/format.js'

const props = defineProps({
  lessonId: { type: String, required: true }
})

const noteHtml = ref('')
const noteText = ref('')

const found = computed(() => findLesson(decodeURIComponent(props.lessonId)))
const course = computed(() => found.value?.course || { name: '' })
const module = computed(() => found.value?.module || { name: '' })
const lesson = computed(() => found.value?.lesson || null)
const progress = computed(() => (lesson.value ? lessonProgress(lesson.value.id) : { completed: false }))

// The next two lessons in the same course, for the "Up next" list.
const nextLessons = computed(() => {
  if (!found.value) return []
  const all = found.value.course.modules.flatMap((m) => m.lessons)
  const idx = all.findIndex((l) => l.id === lesson.value.id)
  return all.slice(idx + 1, idx + 3)
})

async function loadNote() {
  noteHtml.value = ''
  noteText.value = ''
  if (lesson.value?.note) {
    noteText.value = await bridge.getNote(lesson.value.note)
    noteHtml.value = renderMarkdown(noteText.value || '')
  }
}

function toggleComplete() {
  if (lesson.value) markComplete(lesson.value.id, !progress.value.completed)
}

function openFile(filePath) {
  bridge.openFile(filePath)
}

function goBack() {
  window.location.hash = '#/course/' + encodeURIComponent(course.value.id)
}

onMounted(loadNote)
watch(() => props.lessonId, loadNote)
watch(() => store.courses, loadNote)
</script>

<style scoped>
.lesson-view { max-width: 1080px; margin: 0 auto; padding: 8px 0 48px; }
.center { text-align: center; color: #94a3b8; padding: 64px 0; }
.back { margin-bottom: 16px; }
.crumb { color: #94a3b8; font-size: 13px; margin: 0 0 4px; }
.lesson-head {
  display: flex; justify-content: space-between; align-items: flex-start;
  gap: 16px; margin-bottom: 20px;
}
.lesson-head h1 { font-size: 26px; margin: 0; }
.no-video {
  background: #1e293b; border: 1px dashed #475569; border-radius: 12px;
  padding: 32px; text-align: center; color: #cbd5e1;
}
.no-video-title { font-size: 17px; font-weight: 600; color: #f1f5f9; margin: 0 0 6px; }
.meta-line { color: #94a3b8; font-size: 13px; margin-top: 10px; }
.lesson-body {
  display: grid; grid-template-columns: 1fr 300px; gap: 28px; margin-top: 28px;
}
.notes h2, .resources h2, .up-next h2 { font-size: 16px; margin: 0 0 12px; }
.resources ul, .up-next ul { list-style: none; padding: 0; margin: 0; }
.resources li, .up-next li { margin-bottom: 8px; }
.resource-link {
  background: none; border: none; padding: 0; color: #7dd3fc;
  cursor: pointer; font-size: 14px; text-align: left;
}
.resource-link:hover { text-decoration: underline; }
.up-next a { color: #e2e8f0; text-decoration: none; font-size: 14px; }
.up-next a:hover { text-decoration: underline; }
.done-mark { color: #4ade80; }
.hint { color: #94a3b8; font-size: 13px; }
.size { color: #94a3b8; font-size: 12px; }
.notes-empty { color: #94a3b8; }
@media (max-width: 800px) {
  .lesson-body { grid-template-columns: 1fr; }
  .lesson-head { flex-direction: column; }
}
</style>
