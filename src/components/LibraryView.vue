<template>
  <div class="library-view">
    <div v-if="store.loading" class="center">Loading your library…</div>

    <div v-else-if="!store.libraryPath" class="empty">
      <h1>Welcome to CourseVault</h1>
      <p>Pick a folder on your computer that holds your courses, and CourseVault
        will build your library from it. Your progress stays on this PC —
        nothing is uploaded anywhere.</p>
      <p class="convention">Expected layout:
        <code>Library / &lt;Course&gt; / &lt;Module&gt; / 01 - &lt;Lesson&gt;.mp4</code>
        — with optional <code>.md</code> notes, <code>.srt</code> subtitles and a
        <code>01 - &lt;Lesson&gt;/</code> folder for downloads next to each lesson.</p>
      <button class="btn btn-primary" @click="pickLibrary">Choose library folder</button>
      <p class="hint">Tip: the app ships with a <code>demo-library</code> folder you can
        pick to see the layout in action — one sample course, notes and subtitles, no video files.</p>
    </div>

    <div v-else-if="store.courses.length === 0" class="empty">
      <h1>No courses found</h1>
      <p>The folder <code>{{ store.libraryPath }}</code> has no courses in it yet.
        Add a folder per course, with module folders inside, and lessons inside those.</p>
      <button class="btn btn-primary" @click="pickLibrary">Choose another folder</button>
    </div>

    <div v-else>
      <div class="library-head">
        <div>
          <h1>Your courses</h1>
          <p class="sub">{{ store.courses.length }} course{{ store.courses.length > 1 ? 's' : '' }} ·
            {{ totalLessons }} lessons · {{ completedLessons }} completed</p>
        </div>
        <div class="overall" :title="completedLessons + ' of ' + totalLessons + ' lessons done'">
          <div class="overall-bar"><div :style="{ width: overallPct + '%' }"></div></div>
          <span>{{ overallPct }}% done</span>
        </div>
      </div>

      <div class="course-grid">
        <a
          v-for="course in store.courses"
          :key="course.id"
          class="course-card"
          :href="'#/course/' + encodeURIComponent(course.id)"
        >
          <h2>{{ course.name }}</h2>
          <p class="course-meta">
            {{ course.modules.length }} module{{ course.modules.length > 1 ? 's' : '' }} ·
            {{ course.modules.reduce((n, m) => n + m.lessons.length, 0) }} lessons
          </p>
          <div class="progress-bar"><div :style="{ width: courseProgress(course) + '%' }"></div></div>
          <span class="course-pct">{{ courseProgress(course) }}%</span>
          <p v-if="course.description" class="course-desc">{{ firstLine(course.description) }}</p>
        </a>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { store, totalLessons, completedLessons, pickLibrary, courseProgress } from '../store.js'

const overallPct = computed(() =>
  totalLessons.value === 0 ? 0 : Math.round((completedLessons.value / totalLessons.value) * 100)
)

function firstLine(text) {
  const line = (text || '').split('\n').find((l) => l.trim() !== '') || ''
  return line.replace(/[#*_`]/g, '').trim()
}
</script>

<style scoped>
.library-view { max-width: 1080px; margin: 0 auto; padding: 8px 0 48px; }
.center { text-align: center; color: #94a3b8; padding: 64px 0; }
.empty { max-width: 640px; margin: 48px auto; text-align: center; }
.empty h1 { font-size: 28px; }
.empty p { color: #cbd5e1; line-height: 1.6; }
.convention { font-size: 14px; color: #94a3b8; }
.empty .btn { margin: 6px; }
.library-head { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 24px; }
.library-head h1 { margin: 0; font-size: 26px; }
.sub { color: #94a3b8; margin: 4px 0 0; font-size: 14px; }
.overall { display: flex; align-items: center; gap: 10px; font-size: 13px; color: #94a3b8; }
.overall-bar { width: 140px; height: 8px; background: #1e293b; border-radius: 4px; overflow: hidden; }
.overall-bar div { height: 100%; background: #4ade80; }
.course-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
.course-card {
  display: block; background: #1e293b; border: 1px solid #334155;
  border-radius: 12px; padding: 20px; text-decoration: none; color: inherit;
}
.course-card:hover { border-color: #64748b; }
.course-card h2 { margin: 0 0 6px; font-size: 19px; }
.course-meta { color: #94a3b8; font-size: 13px; margin: 0 0 12px; }
.progress-bar { height: 8px; background: #0f172a; border-radius: 4px; overflow: hidden; }
.progress-bar div { height: 100%; background: #4ade80; }
.course-pct { font-size: 13px; color: #94a3b8; }
.course-desc { color: #cbd5e1; font-size: 14px; line-height: 1.5; margin: 10px 0 0; }
</style>
