# CourseVault

A local-first desktop course library for Windows. Point it at a folder of
video lessons and it builds your catalogue, tracks progress, and resumes
where you left off.

**No accounts. No cloud. No AI.** Your library folder and your progress
stay on your PC.

## What it does (v1)

- **Course catalogue** — courses > modules > lessons, built by scanning a
  local folder you pick. Re-scans automatically when files change.
- **Video player** — plays local MP4s (and MKV/WebM/MOV), resumes where you
  left off, tracks per-lesson and per-course progress.
- **Subtitles** — `.srt` and `.vtt` files next to a video are shown in the player.
- **Lesson notes** — `.md` files next to a lesson are rendered as notes.
- **Downloads & resources** — a folder named like a lesson holds its files;
  they open in their default app.
- **Search** — across lesson titles, notes and subtitle text.
- **Local state** — progress, resume positions and the last library folder
  are stored in a JSON file in the app-data folder. No server, no database
  setup.

## Library folder layout

```
Library/
  <Course>/
    course.md              # optional: course title + description
    <Module>/
      01 - <Lesson>.mp4    # video (optional)
      01 - <Lesson>.srt    # subtitles (optional; .vtt also works)
      01 - <Lesson>.md     # notes (optional)
      01 - <Lesson>/       # downloads / resources for that lesson
```

- A leading number (`01 - `) sets the order; without one, lessons sort alphabetically.
- A lesson needs at least one of: a video, a notes file, or subtitles.
- Flatter folders work too: videos directly inside a course folder become
  one "Lessons" module, and videos directly inside the folder you pick
  become one course named after that folder.
- Nothing is renamed or moved. A `demo-library/` folder ships with the
  source repo so you can see the layout in action (one sample course, notes
  and subtitles, no video files) — pick it as your library folder to try
  the app out.

> **Tauri branch.** This is the Tauri 2 + Vue 3 rebuild of CourseVault —
> same features, same local-only behaviour, but a ~10–20 MB Windows exe
> instead of Electron's 155 MB (Tauri uses the system's WebView instead of
> bundling Chromium). The Electron v1 lives on `main`.

## Run it in development

```bash
npm install
npm run dev        # Tauri dev: Vite on :1420 + the Rust app
```

Requirements: Node 20+ and npm, plus a Rust toolchain (cargo 1.99+).
On Linux, Tauri also needs the WebKitGTK system libraries:

```bash
sudo apt install libwebkit2gtk-4.1-dev libsoup-3.0-dev libgtk-3-dev \
  libjavascriptcoregtk-4.1-dev librsvg2-dev
```

The app icons live in `src-tauri/icons/` and are binary files, so they are
not part of snapshot pushes of this branch. After a fresh clone, regenerate
them before building (needs Pillow: `pip install Pillow`):

```bash
python3 scripts/generate-icons.py
```

## Build the Windows app

```bash
npx tauri build --target x86_64-pc-windows-msvc --runner cargo-xwin   # from Linux
npx tauri build                                                       # on a Windows PC
```

Cross-compiling the Windows build from Linux uses
[cargo-xwin](https://github.com/rust-cross/cargo-xwin), which downloads the
Windows SDK/CRT from Microsoft on first use:

```bash
cargo install cargo-xwin
rustup target add x86_64-pc-windows-msvc
npx tauri build --target x86_64-pc-windows-msvc --runner cargo-xwin
```

That produces an NSIS installer under
`src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`. Building
natively on a Windows PC (`npx tauri build`) works the same way and needs
no cross-compilation setup.

## Project layout

```
course-vault/            (branch: tauri)
  src-tauri/
    src/
      main.rs      # window, Tauri commands, state, watcher
      scanner.rs   # library scanner (nested + flat layouts)
      media_server.rs  # loopback HTTP server that streams lesson media
    tauri.conf.json
    capabilities/default.json
  src/
    main.js        # Vue entry point
    App.vue        # shell: header, search, hash routing
    store.js       # reactive state + library/progress/search actions
    lib/
      bridge.js    # Tauri invoke() bridge (replaces the Electron preload)
      markdown.js  # tiny Markdown renderer for notes
      format.js    # time / file-size formatting
    components/
      LibraryView.vue   # course catalogue
      CourseView.vue    # modules + lesson list with progress
      LessonView.vue    # player, notes, resources, up-next
      VideoPlayer.vue   # <video> + resume + subtitles
      SearchView.vue    # search results
  demo-library/    # sample course showing the folder convention
```

## Tech

Tauri 2 + Vue 3 (composition API) + Vite + Rust. The Rust side does all
filesystem work (scanner, state, watcher, subtitles); the renderer only
talks to it through Tauri commands. State is a JSON file, not a database.

## Media playback — why there is a local HTTP server

Lesson videos are **not** served over Tauri's `asset://` protocol. On
Linux, WebKitGTK's media pipeline (GStreamer) cannot play `asset://`
URLs — the `<video>` element fails with `MEDIA_ERR_SRC_NOT_SUPPORTED`
(code 4) even though the same protocol works for images and fetch. So the
Rust backend runs a tiny loopback HTTP server (`src-tauri/src/media_server.rs`,
std only, no extra crates) on an ephemeral `127.0.0.1` port with `Range`
support, and the player points at
`http://127.0.0.1:<port>/<url-encoded path>`. It only ever serves files
inside the currently picked library folder (canonicalised + prefix-checked),
binds loopback only, and dies with the app. Nothing leaves the machine.

## License

MIT
