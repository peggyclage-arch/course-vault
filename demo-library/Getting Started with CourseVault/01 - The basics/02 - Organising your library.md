# Organising your library

CourseVault reads your folder structure — it never renames or moves your
files. The layout it understands:

```
Library/
  <Course>/
    course.md              <- optional: course title + description
    <Module>/
      01 - <Lesson>.mp4    <- the video (optional)
      01 - <Lesson>.srt    <- subtitles (optional; .vtt also works)
      01 - <Lesson>.md     <- notes (optional)
      01 - <Lesson>/       <- downloads / resources for that lesson
```

## Naming

- A leading number (`01 - `, `02 - `) sets the order. Without a number,
  lessons sort alphabetically.
- The lesson title is the filename without the number and extension.
- A lesson needs at least one of: a video, a notes file, or subtitles.
  A folder on its own is not a lesson.

## What is remembered

- The last library folder you opened.
- Where you left off in each video, and which lessons you finished.

All of it lives in a `coursevault-state.json` file in the app-data folder
on this PC. Delete that file to reset CourseVault completely.
