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

## Run it in development

```bash
npm install
npm run dev        # starts Vite + Electron together
```

Requirements: Node 20+ and npm. No Rust toolchain needed.

## Build the Windows app

```bash
npm run build:win   # vite build + electron-builder, Windows x64 portable
```

This produces a portable `CourseVault-<version>-win-x64.exe` in `dist/` —
a single file you can run without installing. (An NSIS installer target
needs Wine when building on Linux, or building on Windows; the portable
build is the default for that reason.)

## Project layout

```
course-vault/
  electron/
    main.js        # window, file protocol, library scanner, state, watcher
    preload.js     # the only bridge the renderer can use (contextBridge)
  src/
    main.js        # Vue entry point
    App.vue        # shell: header, search, hash routing
    store.js       # reactive state + library/progress/search actions
    lib/
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

Electron + Vue 3 (composition API) + Vite. The main process does all
filesystem work; the renderer only talks to it through the preload bridge.
State is a JSON file, not a database.

## License

MIT
