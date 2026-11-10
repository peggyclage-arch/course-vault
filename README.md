# CourseVault

A local-first desktop course library for Windows. Point it at a folder of
video lessons and it builds your catalogue, tracks progress, and resumes
where you left off.

**No accounts. No cloud. No AI.** Your library folder and your progress
stay on your PC.

## What it does (v1)

- **Course catalogue** — courses > modules > lessons, built by scanning a
  local folder you pick, or a Mega folder link you add. Re-scans
  automatically when local files change.
- **Video player** — plays local MP4s (and MKV/WebM/MOV) and videos streamed
  from Mega, resumes where you left off, tracks per-lesson and per-course
  progress.
- **Subtitles** — `.srt` and `.vtt` files next to a video are shown in the player.
- **Lesson notes** — `.md` files next to a lesson are rendered as notes.
- **Downloads & resources** — a folder named like a lesson holds its files;
  they open in their default app. Files that share a lesson's name (for
  example a `.pdf` handout) also show up as that lesson's resources.
- **Search** — across lesson titles, notes and subtitle text.
- **Local state** — progress, resume positions, the last library folder and
  your Mega links are stored in a JSON file in the app-data folder. No
  server, no database setup.

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

## Mega folder links

Next to **Choose folder** there is an **Add Mega link** button. Paste a
Mega folder link (the full link, including the `#key` part) and CourseVault
reads that folder and adds its courses to the same catalogue, marked with a
☁️ Mega badge. The local folder and any Mega links form **one combined
library**; both are remembered between launches.

- A link to a single course folder becomes one course: its subfolders are
  the modules. A link to a folder holding several courses becomes several
  courses. The same grouping rules apply as for local folders (video +
  `.md` notes + `.srt`/`.vtt` subtitles + same-named resources, nested or
  flat layouts).
- Mega files are encrypted on Mega's servers; the app decrypts them with
  the key from the link using the `megajs` library. **No Mega account is
  needed** and nothing is uploaded.
- **Video playback streams** — the video is fetched from Mega in 8 MiB
  chunks as you watch and seek, and the fetched bytes are kept in a sparse
  cache file under the app-data folder (`mega-cache/`), so re-watching a
  part you already watched plays from disk. Nothing is bulk-downloaded:
  a whole course is never downloaded up front, and a video you never open
  is never fetched. Notes, subtitles and resource files are downloaded on
  demand and cached the same way.
- Progress, resume positions and search work for Mega lessons exactly as
  for local ones. Mega folders cannot be live-watched, so a Mega link is
  re-listed on every launch and on every re-scan.
- Removing a Mega link (the × on its chip in the header) forgets the link;
  the downloaded cache files are left on disk and can be deleted from the
  app-data folder if you want the space back.
- Mega links with a `/folder/<handle>` suffix in the link (a subfolder of a
  shared folder) are supported; links to a single file are not — share the
  folder the file lives in instead.

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
    mega.js        # Mega links: listing, decrypting, streaming + sparse cache
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

Electron 45 + Vue 3 (composition API) + Vite. The main process does all
filesystem and network work; the renderer only talks to it through the
preload bridge. State is a JSON file, not a database.

Note: Electron 45 is required (not 36) — its main-process `fetch` is Node's
implementation, which honours the standard proxy environment variables, so
Mega works for users behind a proxy. Electron 36's main-process `fetch`
ignores those variables and fails in proxied environments.

## License

MIT
