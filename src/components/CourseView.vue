<template>
  <div class="course-view">
    <div v-if="!course" class="center">Course not found. <a href="#/">Back to library</a></div>

    <div v-else>
      <button class="btn btn-ghost back" @click="goBack">← All courses</button>
      <h1>{{ course.name }}</h1>
      <p class="sub">{{ course.modules.length }} modules ·
        {{ course.modules.reduce((n, m) => n + m.lessons.length, 0) }} lessons ·
        {{ courseProgress(course) }}% complete</p>
      <div class="progress-bar big"><div :style="{ width: courseProgress(course) + '%' }"></div></div>
      <div v-if="descriptionHtml" class="markdown description" v-html="descriptionHtml"></div>

      <section v-for="mod in course.modules" :key="mod.id" class="module">
        <h2>{{ mod.name }}</h2>
        <ul class="lesson-list">
          <li v-for="lesson in mod.lessons" :key="lesson.id">
            <a :href="'#/lesson/' + encodeURIComponent(lesson.id)" class="lesson-row">
              <span class="lesson-status">
                <span v-if="lessonProgress(lesson.id).completed" class="done">✓</span>
                <span v-else-if="lessonProgress(lesson.id).position > 0" class="partial">◐</span>
                <span v-else class="todo">○</span>
              </span>
              <span class="lesson-name">{{ lesson.name }}</span>
              <span class="lesson-tags">
                <span v-if="lesson.video" class="tag">video</span>
                <span v-else class="tag tag-text">notes</span>
                <span v-if="lesson.subtitles.length" class="tag">subtitles</span>
                <span v-if="lesson.resources.length" class="tag">{{ lesson.resources.length }} file{{ lesson.resources.length > 1 ? 's' : '' }}</span>
              </span>
              <span v-if="lessonProgress(lesson.id).position > 0 && !lessonProgress(lesson.id).completed" class="lesson-resume">
                {{ formatTime(lessonProgress(lesson.id).position) }}
              </span>
            </a>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { store, courseProgress, lessonProgress } from '../store.js'
import { renderMarkdown } from '../lib/markdown.js'
import { formatTime } from '../lib/format.js'

const props = defineProps({
  courseId: { type: String, required: true }
})

const course = computed(() =>
  store.courses.find((c) => c.id === decodeURIComponent(props.courseId))
)

const descriptionHtml = computed(() =>
  course.value?.description ? renderMarkdown(course.value.description) : ''
)

function goBack() {
  window.location.hash = '#/'
}
</script>

<style scoped>
.course-view { max-width: 880px; margin: 0 auto; padding: 8px 0 48px; }
.center { text-align: center; color: #94a3b8; padding: 64px 0; }
.back { margin-bottom: 16px; }
.course-view h1 { font-size: 28px; margin: 0; }
.sub { color: #94a3b8; margin: 6px 0 12px; font-size: 14px; }
.progress-bar { height: 8px; background: #1e293b; border-radius: 4px; overflow: hidden; }
.progress-bar.big { height: 10px; }
.progress-bar div { height: 100%; background: #4ade80; }
.description { margin: 20px 0 8px; color: #cbd5e1; }
.module { margin-top: 32px; }
.module h2 { font-size: 19px; margin: 0 0 10px; }
.lesson-list { list-style: none; padding: 0; margin: 0; }
.lesson-row {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px; border-radius: 10px;
  background: #1e293b; border: 1px solid #334155;
  color: inherit; text-decoration: none; margin-bottom: 8px;
}
.lesson-row:hover { border-color: #64748b; }
.lesson-status { font-size: 16px; width: 20px; text-align: center; }
.done { color: #4ade80; }
.partial { color: #facc15; }
.todo { color: #64748b; }
.lesson-name { flex: 1; font-size: 15px; }
.lesson-tags { display: flex; gap: 6px; }
.tag { font-size: 11px; background: #0f172a; color: #94a3b8; border-radius: 6px; padding: 2px 7px; }
.tag-text { color: #7dd3fc; }
.lesson-resume { font-size: 12px; color: #94a3b8; }
</style>
