<template>
  <div class="player">
    <video
      ref="videoEl"
      :key="lesson.id"
      controls
      preload="metadata"
      :src="videoSrc"
      @loadedmetadata="onLoadedMetadata"
      @timeupdate="onTimeUpdate"
      @pause="onPause"
      @ended="onEnded"
    >
      <track
        v-if="subtitleUrl"
        kind="subtitles"
        label="Subtitles"
        default
        :src="subtitleUrl"
      />
    </video>
    <div v-if="resumeAt > 0 && !resumed" class="resume-bar">
      <span>You left off at {{ formatTime(resumeAt) }}.</span>
      <button class="btn btn-small" @click="jumpToResume">Resume from {{ formatTime(resumeAt) }}</button>
      <button class="btn btn-small btn-ghost" @click="startOver">Start over</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { lessonProgress, saveProgress, flushProgress } from '../store.js'
import { formatTime } from '../lib/format.js'
import { bridge } from '../lib/bridge.js'

const props = defineProps({
  lesson: { type: Object, required: true }
})

const videoEl = ref(null)
const subtitleUrl = ref(null)
let subtitleBlob = null
const resumed = ref(false)
const resumeAt = ref(0)

const videoSrc = computed(() =>
  props.lesson.video ? bridge.mediaUrl(props.lesson.video) : ''
)

// Load subtitles (if any) as a blob URL so the <track> element can use them.
async function loadSubtitles() {
  if (subtitleBlob) {
    URL.revokeObjectURL(subtitleBlob)
    subtitleBlob = null
  }
  subtitleUrl.value = null
  const sub = props.lesson.subtitles[0]
  if (!sub) return
  const vtt = await bridge.getSubtitles(sub.path)
  if (!vtt) return
  subtitleBlob = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }))
  subtitleUrl.value = subtitleBlob
}

function onLoadedMetadata() {
  const video = videoEl.value
  if (!video) return
  const p = lessonProgress(props.lesson.id)
  saveProgress(props.lesson.id, { duration: video.duration })
  // Resume where the user left off (unless barely started or nearly done).
  if (p.position > 5 && p.duration > 0 && p.position < p.duration - 5) {
    resumeAt.value = p.position
    resumed.value = false
  }
}

function jumpToResume() {
  if (videoEl.value) {
    videoEl.value.currentTime = resumeAt.value
    videoEl.value.play()
  }
  resumed.value = true
}

function startOver() {
  if (videoEl.value) videoEl.value.currentTime = 0
  resumed.value = true
  saveProgress(props.lesson.id, { position: 0, completed: false })
}

let lastSaved = 0
function onTimeUpdate() {
  const video = videoEl.value
  if (!video) return
  const now = Date.now()
  if (now - lastSaved < 5000 && video.currentTime < video.duration - 1) return
  lastSaved = now
  const completed = video.duration > 0 && video.currentTime / video.duration >= 0.9
  saveProgress(props.lesson.id, {
    position: video.currentTime,
    duration: video.duration,
    ...(completed ? { completed: true } : {})
  })
}

function onPause() {
  flushProgress(props.lesson.id)
}

function onEnded() {
  saveProgress(props.lesson.id, { position: 0, completed: true })
  flushProgress(props.lesson.id)
}

onMounted(loadSubtitles)
onBeforeUnmount(() => {
  if (subtitleBlob) URL.revokeObjectURL(subtitleBlob)
  // Save the position when leaving the lesson mid-video.
  if (videoEl.value && !videoEl.value.ended) {
    saveProgress(props.lesson.id, {
      position: videoEl.value.currentTime,
      duration: videoEl.value.duration || lessonProgress(props.lesson.id).duration
    })
  }
  flushProgress(props.lesson.id)
})

watch(() => props.lesson.id, () => {
  resumed.value = false
  resumeAt.value = 0
  loadSubtitles()
})
</script>

<style scoped>
.player video {
  width: 100%;
  max-height: 62vh;
  background: #000;
  border-radius: 12px;
  display: block;
}
.resume-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  padding: 10px 14px;
  background: #1e293b;
  border: 1px solid #334155;
  border-radius: 10px;
  font-size: 14px;
}
</style>
