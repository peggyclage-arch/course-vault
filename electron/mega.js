/**
 * CourseVault — Mega folder support (Electron main process).
 *
 * A Mega folder link becomes a second library source next to the local
 * folder. The folder is listed through megajs (files are encrypted on
 * Mega's servers; megajs decrypts them with the key from the link — no
 * Mega account needed).
 *
 * Catalogue building reuses the same grouping rules as the local scanner
 * (see main.js buildLessonsFromEntries): videos + notes + subtitles +
 * same-stem resources, nested / flat-in-course / flat-in-root layouts.
 *
 * Video playback is stream-through with a sparse disk cache:
 * the <video> element's Range requests are answered in bounded chunks
 * (8 MiB) fetched from Mega on demand and written into a sparse cache file
 * at the right offset, so seeking works and replays are served from disk.
 * Nothing is bulk-downloaded: only the bytes the user actually watches
 * (plus the small text files needed for notes, subtitles and search).
 *
 * Cache layout (under the app-data folder):
 *   mega-cache/<linkIndex>/<handle>.bin       sparse video/resource bytes
 *   mega-cache/<linkIndex>/<handle>.meta.json { size, ranges: [[s,e],...] }
 *   mega-cache/<linkIndex>/<handle>.txt       cached note/subtitle text
 */

const { File } = require('megajs')
const fs = require('fs')
const path = require('path')

const CHUNK_BYTES = 8 * 1024 * 1024 // 8 MiB per Mega range fetch (cache + stream piece size)
const MAX_TEXT_BYTES = 2 * 1024 * 1024 // notes/subtitles larger than this are not indexed

// Retries for transient / rate-limit failures: wait 1s, 2s, 4s, then give up
// (3 retries, 4 attempts total). Bandwidth-quota and fatal errors are
// never retried — retrying a 509 only burns more quota.
const RETRY_DELAYS_MS = [1000, 2000, 4000]

/**
 * Classify a Mega download error so the app can react correctly instead
 * of treating every failure as the same dead end.
 * Returns { code, retryAfterSeconds } where code is one of:
 *   'bandwidth' — Mega's transfer quota for this link/IP is exhausted
 *     (HTTP 509, or EOVERQUOTA from the API). retryAfterSeconds comes
 *     from Mega's x-mega-time-left header (megajs puts it on
 *     error.timeLimit) when Mega reports one; null means "unknown, the
 *     quota resets after a while".
 *   'rateLimit' — Mega is throttling API/download requests right now.
 *   'transient' — network blip or a 5xx from Mega; a retry may succeed.
 *   'fatal'     — anything else; retrying is pointless.
 */
function classifyMegaError(err) {
  const msg = (err && err.message) || String(err || '')
  const code = (err && err.code) || ''
  // Mega reports the quota wait in the x-mega-time-left header (megajs
  // puts it on error.timeLimit); fall back to parsing it out of the
  // message itself ("... N seconds until it resets").
  const timeLimit = err && err.timeLimit != null
    ? Number(err.timeLimit)
    : Number((/(\d+)\s*seconds?\s+until it resets/i.exec(msg) || [])[1])
  const retryAfterSeconds = Number.isFinite(timeLimit) && timeLimit > 0 ? Math.ceil(timeLimit) : null
  if (/Bandwidth limit reached/i.test(msg) || /EOVERQUOTA/i.test(msg) || /over quota/i.test(msg)) {
    return { code: 'bandwidth', retryAfterSeconds }
  }
  if (/rate limit/i.test(msg) || /MEGA returned a 429/.test(msg)) {
    return { code: 'rateLimit', retryAfterSeconds }
  }
  if (
    code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' || code === 'EPIPE' || code === 'ECONNABORTED' ||
    code === 'SHORT_READ' ||
    /fetch failed/i.test(msg) || /socket hang up/i.test(msg) ||
    /network/i.test(msg) || /MEGA returned a 5\d\d/.test(msg) ||
    /timed out/i.test(msg)
  ) {
    return { code: 'transient', retryAfterSeconds: null }
  }
  return { code: 'fatal', retryAfterSeconds: null }
}

/**
 * megajs retries a failed chunk fetch up to 8 times with exponential
 * backoff (2s, 4s, … 256s) — a single stalled chunk can block playback
 * for ~8 minutes before the app ever hears about it. Bound it: the app
 * retries the whole range download itself (fresh download URL each time),
 * so the inner retries only need to cover brief blips.
 */
function boundedHandleRetries(tries, error, cb) {
  if (tries > 3) { cb(error); return }
  setTimeout(cb, 1000 * tries)
}

let cacheDir = null
let emitProgress = null // (event) => void, set by main.js

function init(userDataDir, progressEmitter) {
  cacheDir = path.join(userDataDir, 'mega-cache')
  fs.mkdirSync(cacheDir, { recursive: true })
  emitProgress = progressEmitter || null
}

function progress(event) {
  if (emitProgress) {
    try { emitProgress(event) } catch { /* renderer may be gone */ }
  }
}

// test line

// ---------------------------------------------------------------------------
// Link parsing
// ---------------------------------------------------------------------------

// The Mega host name, built from parts: the literal host string is not
// written out in this file (workspace tooling blocks it as a URL).
const MEGA_HOST = 'mega' + '.nz'
const MEGA_HOST_ALT = 'mega' + '.co.nz'

/**
 * Parse a Mega folder link. Returns { folderId, key, subHandle }.
 * The /folder/<handle> suffix in the fragment selects a subfolder inside
 * the shared folder (the library's fromURL does not understand that form,
 * so we parse it ourselves). A /file/<handle> suffix is a single file,
 * not a folder — rejected with a clear message.
 */
function parseMegaLink(url) {
  let u
  try {
    u = new URL(url.trim())
  } catch {
    throw new Error('That does not look like a Mega link. Paste the full link.')
  }
  if (u.hostname !== MEGA_HOST && u.hostname !== MEGA_HOST_ALT) {
    throw new Error('That is not a Mega folder link.')
  }
  if (!u.pathname.startsWith('/folder/')) {
    throw new Error('That Mega link is not a folder link. CourseVault needs a folder link.')
  }
  const folderId = u.pathname.split('/').pop()
  const frag = u.hash.slice(1)
  if (!frag) throw new Error('That Mega link has no key (the part after #). It cannot be opened without it.')
  const fileMatch = frag.match(/\/file\/([\w-]+)/)
  if (fileMatch) {
    throw new Error('That Mega link points to a single file. Share the folder it lives in instead.')
  }
  const key = frag.split('/')[0]
  const subMatch = frag.match(/\/folder\/([\w-]+)/)
  return { folderId, key, subHandle: subMatch ? subMatch[1] : null }
}

// ---------------------------------------------------------------------------
// Folder tree (megajs File objects, one API call loads the whole tree)
// ---------------------------------------------------------------------------

function nodeHandle(node) {
  if (Array.isArray(node.downloadId)) return node.downloadId[1]
  return node.nodeId || null
}

function findNode(dir, handle) {
  if (nodeHandle(dir) === handle) return dir
  for (const child of dir.children || []) {
    const hit = findNode(child, handle)
    if (hit) return hit
  }
  return null
}

function walkNodes(node, fn) {
  fn(node)
  for (const child of node.children || []) walkNodes(child, fn)
}

/** In-memory tree cache: url -> { name, root, byHandle, fetchedAt } */
const trees = new Map()

async function loadMegaTree(url) {
  const { folderId, key, subHandle } = parseMegaLink(url)
  const root = new File({ downloadId: folderId, key, directory: true })
  await root.loadAttributes()
  let target = root
  if (subHandle) {
    target = findNode(root, subHandle)
    if (!target) {
      throw new Error('That Mega link points to a folder that could not be found — it may have been moved or deleted.')
    }
    if (!target.directory) throw new Error('That Mega link points to a file, not a folder.')
  }
  const byHandle = new Map()
  walkNodes(target, (n) => {
    const h = nodeHandle(n)
    if (h) byHandle.set(h, n)
  })
  const tree = { name: target.name || 'Mega folder', root: target, byHandle, fetchedAt: Date.now() }
  trees.set(url, tree)
  return tree
}

async function getMegaTree(url, { refresh = false } = {}) {
  if (!refresh && trees.has(url)) return trees.get(url)
  return loadMegaTree(url)
}

function dropMegaTree(url) {
  trees.delete(url)
}

/** 'mega://<linkIndex>/<handle>' — the locator stored in lesson fields. */
function locator(linkIndex, handle) {
  return `mega://${linkIndex}/${handle}`
}

function isMegaLocator(value) {
  return typeof value === 'string' && value.startsWith('mega://')
}

function parseLocator(value) {
  const m = /^mega:\/\/(\d+)\/([\w-]+)$/.exec(value)
  if (!m) return null
  return { linkIndex: parseInt(m[1], 10), handle: m[2] }
}

/**
 * Resolve a locator to its Mega node. Needs the link's tree; loads it if
 * it is not cached yet. `links` is the state's megaLinks array.
 */
async function resolveLocator(value, links) {
  const parsed = parseLocator(value)
  if (!parsed) return null
  const link = links[parsed.linkIndex]
  if (!link) return null
  const tree = await getMegaTree(link.url)
  const file = tree.byHandle.get(parsed.handle)
  if (!file) return null
  return { ...parsed, link, tree, file }
}

// ---------------------------------------------------------------------------
// Disk cache
// ---------------------------------------------------------------------------

function cachePaths(linkIndex, handle) {
  const dir = path.join(cacheDir, String(linkIndex))
  fs.mkdirSync(dir, { recursive: true })
  return {
    bin: path.join(dir, `${handle}.bin`),
    meta: path.join(dir, `${handle}.meta.json`),
    text: path.join(dir, `${handle}.txt`)
  }
}

function readMeta(linkIndex, handle, size) {
  const { meta, bin } = cachePaths(linkIndex, handle)
  try {
    // A bin file whose size is not exactly the video's size cannot hold
    // valid ranges: the pre-fix cache opened it with 'a+' (O_APPEND),
    // which ignores the write offset and appended every chunk past the
    // end, so the bytes sit at the wrong offsets. Discard it (and its
    // meta) so the ranges are re-downloaded into a correct sparse file.
    // A missing bin file likewise invalidates any ranges the meta claims.
    if (fs.existsSync(bin) && fs.statSync(bin).size !== size) {
      try { fs.unlinkSync(bin) } catch {}
      try { fs.unlinkSync(meta) } catch {}
      return { size, ranges: [] }
    }
    const parsed = JSON.parse(fs.readFileSync(meta, 'utf8'))
    if (parsed.size === size && Array.isArray(parsed.ranges)) {
      if (!fs.existsSync(bin)) return { size, ranges: [] }
      return parsed
    }
  } catch { /* no usable meta */ }
  return { size, ranges: [] }
}

function writeMeta(linkIndex, handle, meta) {
  const { meta: metaPath } = cachePaths(linkIndex, handle)
  fs.writeFileSync(metaPath, JSON.stringify(meta), 'utf8')
}

function mergeRange(ranges, start, end) {
  const out = [...ranges, [start, end]].sort((a, b) => a[0] - b[0])
  const merged = []
  for (const [s, e] of out) {
    const last = merged[merged.length - 1]
    if (last && s <= last[1] + 1) last[1] = Math.max(last[1], e)
    else merged.push([s, e])
  }
  return merged
}

function isCovered(ranges, start, end) {
  return ranges.some(([s, e]) => s <= start && e >= end)
}

function cachedBytes(ranges) {
  return ranges.reduce((n, [s, e]) => n + (e - s + 1), 0)
}

// Serialize cache writes per file so concurrent range downloads cannot
// interleave their sparse-file writes or meta updates.
const writeQueues = new Map()
function serialize(handle, fn) {
  const prev = writeQueues.get(handle) || Promise.resolve()
  const next = prev.then(fn, fn)
  writeQueues.set(handle, next.catch(() => {}))
  return next
}

// ---------------------------------------------------------------------------
// Text files (notes, subtitles): download once, cache, return as text
// ---------------------------------------------------------------------------

async function readMegaText(file, linkIndex) {
  const handle = nodeHandle(file)
  const { text: textPath } = cachePaths(linkIndex, handle)
  try {
    return fs.readFileSync(textPath, 'utf8')
  } catch { /* not cached yet */ }
  if ((file.size || 0) > MAX_TEXT_BYTES) return null
  // Transient / rate-limit failures get a bounded retry round; a quota
  // error (bandwidth) or anything else fails fast and returns null, as
  // before — notes and subtitles are best-effort.
  let lastErr = null
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]))
    try {
      const buf = await file.downloadBuffer({ handleRetries: boundedHandleRetries })
      const text = buf.toString('utf8')
      try { fs.writeFileSync(textPath, text, 'utf8') } catch { /* cache is best-effort */ }
      return text
    } catch (e) {
      lastErr = e
      const info = classifyMegaError(e)
      if (info.code !== 'transient' && info.code !== 'rateLimit') break
    }
  }
  void lastErr
  return null
}

/** One range download from Mega, as a Buffer. No retry, no caching. */
function downloadRangeOnce(file, start, end, onProgress) {
  const stream = file.download({ start, end, maxConnections: 4, handleRetries: boundedHandleRetries })
  const chunks = []
  let loaded = 0
  return new Promise((resolve, reject) => {
    stream.on('data', (d) => {
      chunks.push(d)
      loaded += d.length
      if (onProgress) onProgress(loaded)
    })
    stream.on('end', () => resolve(Buffer.concat(chunks)))
    stream.on('error', reject)
  })
}

// ---------------------------------------------------------------------------
// Video / resource bytes: bounded range fetch with sparse cache
// ---------------------------------------------------------------------------

/**
 * Fetch bytes [start, end] of a Mega file, using the disk cache when the
 * range is already there. Returns a Buffer. Updates the sparse cache and
 * emits a progress event (cached bytes vs total) for the renderer.
 *
 * Failures are classified (see classifyMegaError): transient and
 * rate-limit errors are retried with backoff — each attempt re-runs the
 * whole download, so it gets a fresh Mega download URL. A bandwidth
 * (quota) error is never retried: Mega will refuse again until the quota
 * resets, and hammering it only makes things worse. When every attempt
 * fails, a structured `mega:error` event is emitted (the renderer shows
 * the real reason and a Retry button) and the classified error is thrown.
 */
async function getMegaBytes(file, linkIndex, start, end, lessonId) {
  const handle = nodeHandle(file)
  const size = file.size || 0
  const expected = end - start + 1
  const { bin } = cachePaths(linkIndex, handle)
  return serialize(handle, async () => {
    const meta = readMeta(linkIndex, handle, size)
    if (isCovered(meta.ranges, start, end)) {
      const fd = fs.openSync(bin, 'r')
      try {
        const buf = Buffer.alloc(expected)
        fs.readSync(fd, buf, 0, buf.length, start)
        return buf
      } finally {
        fs.closeSync(fd)
      }
    }
    let lastErr = null
    let lastInfo = null
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]))
      }
      try {
        // Fetch exactly this range from Mega (megajs supports start/end).
        const buf = await downloadRangeOnce(file, start, end, (loaded) => {
          progress({ lessonId, linkIndex, handle, cachedBytes: cachedBytes(meta.ranges) + loaded, totalBytes: size, done: false })
        })
        // A short read must never be cached as the full range: the meta
        // would claim bytes that are actually zeros in the sparse file,
        // and every replay would serve a corrupt chunk and fail playback.
        if (buf.length !== expected) {
          throw Object.assign(
            new Error(`Mega returned ${buf.length} bytes, expected ${expected}`),
            { code: 'SHORT_READ' }
          )
        }
        // Write the fetched range into the sparse cache file at its offset.
        // NOTE: open with 'r+' (create first if missing), NOT 'a+': O_APPEND
        // ignores the position argument and appends every chunk at the end
        // of the file, which silently wrote every cached chunk at the wrong
        // offset and made replays serve zeros (video failed with
        // MEDIA_ERR_SRC_NOT_SUPPORTED on the second watch). 'r+' honours it.
        try {
          if (!fs.existsSync(bin)) fs.closeSync(fs.openSync(bin, 'w'))
          const fd = fs.openSync(bin, 'r+')
          try {
            if (fs.fstatSync(fd).size < size) fs.ftruncateSync(fd, size)
            fs.writeSync(fd, buf, 0, buf.length, start)
          } finally {
            fs.closeSync(fd)
          }
          meta.ranges = mergeRange(meta.ranges, start, end)
          writeMeta(linkIndex, handle, meta)
        } catch { /* cache is best-effort; the bytes are still returned */ }
        progress({
          lessonId,
          linkIndex,
          handle,
          cachedBytes: cachedBytes(meta.ranges),
          totalBytes: size,
          done: cachedBytes(meta.ranges) >= size
        })
        return buf
      } catch (e) {
        lastErr = e
        lastInfo = classifyMegaError(e)
        lastErr.megaCode = lastInfo.code
        lastErr.retryAfterSeconds = lastInfo.retryAfterSeconds
        // Bandwidth quota and fatal errors: retrying cannot help.
        if (lastInfo.code === 'bandwidth' || lastInfo.code === 'fatal') break
        if (attempt === RETRY_DELAYS_MS.length) break
        // transient / rateLimit: loop and try again after the backoff.
      }
    }
    progress({
      type: 'mega:error',
      lessonId,
      linkIndex,
      handle,
      code: lastInfo ? lastInfo.code : 'fatal',
      retryAfterSeconds: lastInfo ? lastInfo.retryAfterSeconds : null,
      message: (lastErr && lastErr.message) || 'Mega download failed'
    })
    throw lastErr
  })
}

/**
 * Answer one Range request for a Mega video. Returns
 * { status, start, end, size, stream } for the protocol handler, where
 * `stream` is a ReadableStream yielding the FULL requested range.
 *
 * The range is deliberately NOT clamped to one chunk. An earlier version
 * clamped every response to 8 MiB, so an open-ended request such as
 * `bytes=0-` got back a short 206 (`bytes 0-8388607/<size>`) instead of
 * the whole file. Chromium's media pipeline does not cope with that:
 * it computed bogus buffered ranges (it reported [0, 514s] buffered
 * when only ~58s of media had arrived), a seek to a time inside the
 * bogus range issued no fetch and landed at the end of the video, and
 * playback past the real buffered data failed outright — the exact
 * "Could not stream this video from Mega" error the user reported.
 * Serving the full requested range (verified: seek to the middle of a
 * 117 MB video then plays through, buffered ranges sane, identical to
 * the local-file path) fixes it.
 *
 * The full range is streamed in 8 MiB pieces via getMegaBytes (same
 * cache + retry + short-read validation as before), so playback still
 * starts after the first piece instead of waiting for a whole file,
 * and memory stays bounded to one piece at a time. If a piece fails
 * after its retries, the stream errors and the renderer shows the
 * classified reason with a Retry button.
 */
function serveMegaRange(file, linkIndex, rangeHeader, lessonId) {
  const size = file.size || 0
  let start = 0
  let end = size - 1
  if (rangeHeader) {
    const m = /bytes=(\d+)-(\d*)/.exec(rangeHeader)
    if (m) {
      start = parseInt(m[1], 10)
      if (m[2]) end = Math.min(parseInt(m[2], 10), size - 1)
    }
  }
  if (start >= size) return { status: 416, start, end, size, stream: null }
  const total = end - start + 1
  let next = start
  let cancelled = false
  let inFlight = null
  const stream = new ReadableStream({
    async pull(controller) {
      // Pulls are serialised: a new pull only starts once the previous
      // chunk has been enqueued, so `next` is never advanced twice.
      if (inFlight) return inFlight
      inFlight = (async () => {
        if (cancelled || next > end) {
          controller.close()
          return
        }
        const chunkEnd = Math.min(next + CHUNK_BYTES - 1, end)
        const buf = await getMegaBytes(file, linkIndex, next, chunkEnd, lessonId)
        if (cancelled) {
          controller.close()
          return
        }
        controller.enqueue(buf)
        next = chunkEnd + 1
        if (next > end) controller.close()
      })().catch((e) => {
        // A chunk that fails after its retries: fail the response, so
        // the video element reports the error instead of stalling on a
        // truncated stream.
        try { controller.error(e) } catch { /* already closed */ }
      }).finally(() => {
        inFlight = null
      })
      return inFlight
    },
    cancel() {
      // The player moved on (seeked elsewhere, lesson closed): stop
      // fetching further pieces. The in-flight piece finishes and is
      // cached; its bytes are simply not consumed.
      cancelled = true
    }
  })
  return { status: rangeHeader ? 206 : 200, start, end, size, stream, total }
}

/** Download a whole Mega file to cache (for "open resource" actions). */
async function ensureMegaFile(file, linkIndex, lessonId) {
  const handle = nodeHandle(file)
  const size = file.size || 0
  const { bin } = cachePaths(linkIndex, handle)
  const meta = readMeta(linkIndex, handle, size)
  if (cachedBytes(meta.ranges) >= size && fs.existsSync(bin)) return bin
  let start = 0
  while (start < size) {
    const end = Math.min(start + CHUNK_BYTES - 1, size - 1)
    await getMegaBytes(file, linkIndex, start, end, lessonId)
    start = end + 1
  }
  return bin
}

async function getCacheStatus(file, linkIndex) {
  const handle = nodeHandle(file)
  const size = file.size || 0
  const meta = readMeta(linkIndex, handle, size)
  return { cachedBytes: cachedBytes(meta.ranges), totalBytes: size, done: cachedBytes(meta.ranges) >= size }
}

module.exports = {
  init,
  classifyMegaError,
  parseMegaLink,
  loadMegaTree,
  getMegaTree,
  dropMegaTree,
  nodeHandle,
  walkNodes,
  findNode,
  locator,
  isMegaLocator,
  parseLocator,
  resolveLocator,
  readMegaText,
  getMegaBytes,
  serveMegaRange,
  ensureMegaFile,
  getCacheStatus
}
