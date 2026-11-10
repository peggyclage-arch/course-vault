<template>
  <div class="player">
    <video
      ref="videoEl"
      :key="lesson.id + ':' + reloadCount"
      controls
      preload="metadata"
      :src="videoSrc"
      @loadedmetadata="onLoadedMetadata"
      @timeupdate="onTimeUpdate"
      @pause="onPause"
      @ended="onEnded"
      @error="onVideoError"
    >
      <track
        v-if="subtitleUrl"
        kind="subtitles"
        label="Subtitles"
        default
        :src="subtitleUrl"
      />
    </video>
    <div v-if="isMega && megaStatus && !megaStatus.done" class="mega-status">
      ☁️ Streaming from Mega — {{ formatBytes(megaStatus.cachedBytes) }} of {{ formatBytes(megaStatus.totalBytes) }} cached on this PC
    </div>
    <div v-if="megaError" class="mega-status mega-status-error">
      <span>{{ megaError }}</span>
      <button class="btn btn-small" @click="retryMega">Retry</button>
    </div>
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
import { formatTime, formatBytes } from '../lib/format.js'

const props = defineProps({
  lesson: { type: Object, required: true }
})

const videoEl = ref(null)
const subtitleUrl = ref(null)
let subtitleBlob = null
const resumed = ref(false)
const resumeAt = ref(0)
const reloadCount = ref(0) // bumped by Retry to remount the <video> element

// Mega streaming status: which bytes of this video are cached on disk.
const isMega = computed(() =>
  typeof props.lesson.video === 'string' && props.lesson.video.startsWith('mega://')
)
const megaStatus = ref(null) // { cachedBytes, totalBytes, done }
const megaError = ref('')
const megaErrorCode = ref('') // 'bandwidth' | 'rateLimit' | 'transient' | 'fatal'
let retryCountdown = null // interval id for the bandwidth wait timer
let stopMegaProgress = null

function formatWait(seconds) {
  if (seconds == null) return 'a while'
  if (seconds < 60) return `${seconds} seconds`
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? '' : 's'}`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return `about ${hours} hour${hours === 1 ? '' : 's'}${rest ? ` ${rest} min` : ''}`
}

function stopRetryCountdown() {
  if (retryCountdown) { clearInterval(retryCountdown); retryCountdown = null }
}

/** Turn a structured mega:error event from the main process into the message shown. */
function onMegaStreamError(event) {
  megaErrorCode.value = event.code || 'fatal'
  stopRetryCountdown()
  if (event.code === 'bandwidth') {
    // Mega's free transfer quota for this link is exhausted. Retrying
    // before the quota resets cannot help, so say when to come back.
    megaError.value = `Mega has paused downloads from this link — its free bandwidth limit is reached. Try again in ${formatWait(event.retryAfterSeconds)}. What you already watched stays cached on this PC.`
    if (event.retryAfterSeconds) {
      let remaining = event.retryAfterSeconds
      retryCountdown = setInterval(() => {
        remaining -= 1
        if (remaining <= 0) {
          stopRetryCountdown()
          megaError.value = 'Mega’s bandwidth limit should have reset by now — press Retry to continue watching.'
          return
        }
        megaError.value = `Mega has paused downloads from this link — its free bandwidth limit is reached. Try again in ${formatWait(remaining)}. What you already watched stays cached on this PC.`
      }, 1000)
    }
  } else if (event.code === 'rateLimit') {
    megaError.value = 'Mega is rate-limiting downloads from this link right now. Wait a moment, then press Retry — what you already watched stays cached.'
  } else if (event.code === 'transient') {
    megaError.value = 'The download from Mega failed (connection problem). Press Retry — what you already watched stays cached.'
  } else {
    megaError.value = 'Could not stream this video from Mega. Press Retry, or check your connection and try again.'
  }
}

/** Reload the video element (already-cached chunks come from disk, so a retry is cheap). */
function retryMega() {
  megaError.value = ''
  megaErrorCode.value = ''
  stopRetryCountdown()
  reloadCount.value += 1
}

function megaHandle() {
  const m = /^mega:\/\/\d+\/([\w-]+)$/.exec(props.lesson.video || '')
  return m ? m[1] : null
}

async function refreshMegaStatus() {
  megaError.value = ''
  if (!isMega.value) { megaStatus.value = null; return }
  try {
    megaStatus.value = await window.coursevault.getMegaStatus(props.lesson.video)
  } catch { megaStatus.value = null }
}

function onVideoError() {
  // The main process already sent a specific reason (bandwidth, rate
  // limit, connection) via the mega:error event — don't clobber it with
  // the generic text. Only fall back to generic when nothing arrived.
  if (isMega.value && !megaError.value) {
    megaError.value = 'Could not stream this video from Mega. Check your connection and try again — Mega sometimes rate-limits downloads for a while.'
  }
}

const videoSrc = computed(() =>
  props.lesson.video ? window.coursevault.mediaUrl(props.lesson.video) : ''
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
  const vtt = await window.coursevault.getSubtitles(sub.path)
  if (!vtt) return
  subtitleBlob = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }))
  subtitleUrl.value = subtitleBlob
}

function onLoadedMetadata() {
  const video = videoEl.value
  if (!video) return
  // A successful load means the stream is working again — clear any
  // earlier Mega error (e.g. after a Retry).
  megaError.value = ''
  megaErrorCode.value = ''
  stopRetryCountdown()
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

onMounted(() => {
  loadSubtitles()
  refreshMegaStatus()
  stopMegaProgress = window.coursevault.onMegaProgress((event) => {
    if (event.handle === megaHandle()) {
      if (event.type === 'mega:error') {
        onMegaStreamError(event)
      } else {
        megaStatus.value = { cachedBytes: event.cachedBytes, totalBytes: event.totalBytes, done: event.done }
      }
    }
  })
})

onBeforeUnmount(() => {
  stopRetryCountdown()
  if (stopMegaProgress) { stopMegaProgress(); stopMegaProgress = null }
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
  stopRetryCountdown()
  loadSubtitles()
  refreshMegaStatus()
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
.mega-status {
  margin-top: 8px;
  padding: 8px 12px;
  background: #0c4a6e;
  color: #bae6fd;
  border: 1px solid #075985;
  border-radius: 8px;
  font-size: 13px;
}
.mega-status-error {
  background: #450a0a;
  color: #fca5a5;
  border-color: #7f1d1d;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
</style>
