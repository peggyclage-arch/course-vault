// Catalogue builder: turns a Mega folder tree into courses > modules > lessons.
// Same grouping rules as the desktop app (see ~/workspace/course-vault/electron/main.js),
// including the flat-layout fix the desktop scanner was missing:
//   - videos directly in a course folder become lessons of one "Lessons" module
//   - videos directly in the linked folder become one course with one module
//   - a linked folder can be a library (children are courses), a course
//     (children are modules), or a single module — the builder works it out
//     from where the video files actually are.

import type { MegaTreeNode } from './client';
import { extOf, sortByPrefix, splitPrefix, stemOf } from '../lib/format';

export const VIDEO_EXTS = new Set(['mp4', 'mkv', 'webm', 'mov']);
export const SUBTITLE_EXTS = new Set(['srt', 'vtt']);
export const NOTE_EXTS = new Set(['md', 'txt']);

export interface LessonResource {
  name: string;
  path: string;
  size: number;
  ext: string;
}

export interface Lesson {
  /** Stable id: the video path, or the note path when there is no video. */
  id: string;
  name: string;
  order: number;
  video: { path: string; size: number } | null;
  note: { path: string; size: number } | null;
  subtitles: { path: string; size: number }[];
  resources: LessonResource[];
}

export interface Module {
  id: string;
  name: string;
  order: number;
  lessons: Lesson[];
  /** Files in this module that belong to no lesson (e.g. "Action Item" PDFs). */
  resources: LessonResource[];
}

export interface Course {
  id: string;
  name: string;
  order: number;
  description: string;
  modules: Module[];
}

export interface Catalogue {
  courses: Course[];
  rootName: string;
}

interface StemGroup {
  stem: string;
  video?: { path: string; size: number };
  note?: { path: string; size: number };
  subtitles: { path: string; size: number }[];
  resources: LessonResource[];
  resourcesDir?: MegaTreeNode;
}

function listFilesRecursive(dir: MegaTreeNode, base: string): LessonResource[] {
  const out: LessonResource[] = [];
  for (const child of dir.children || []) {
    const p = base ? `${base}/${child.name}` : child.name;
    if (child.isDir) out.push(...listFilesRecursive(child, p));
    else out.push({ name: p, path: child.path, size: child.size, ext: extOf(child.name) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Group the files directly inside one directory into lessons (by filename
 * stem) plus orphan resources. A stem is a lesson when it has a video, a
 * note, or subtitles; stems with only PDFs/docs are module resources.
 * When `resourceFolders` is false, subdirectories are ignored entirely
 * (used when collecting flat lessons from a course folder, where the
 * subdirectories are modules, not lesson resource folders).
 */
function collectLessons(
  dir: MegaTreeNode,
  opts?: { resourceFolders?: boolean },
): { lessons: Lesson[]; resources: LessonResource[] } {
  const resourceFolders = opts?.resourceFolders !== false;
  const byStem = new Map<string, StemGroup>();
  const get = (stem: string): StemGroup => {
    let g = byStem.get(stem);
    if (!g) {
      g = { stem, subtitles: [], resources: [] };
      byStem.set(stem, g);
    }
    return g;
  };

  for (const child of dir.children || []) {
    if (child.isDir) {
      if (!resourceFolders) continue;
      // A folder named like a lesson stem holds that lesson's resources.
      const g = get(child.name);
      g.resourcesDir = child;
      continue;
    }
    const ext = extOf(child.name);
    const stem = stemOf(child.name);
    const g = get(stem);
    if (VIDEO_EXTS.has(ext)) {
      if (!g.video) g.video = { path: child.path, size: child.size };
    } else if (NOTE_EXTS.has(ext)) {
      if (!g.note) g.note = { path: child.path, size: child.size };
    } else if (SUBTITLE_EXTS.has(ext)) {
      g.subtitles.push({ path: child.path, size: child.size });
    } else {
      g.resources.push({ name: child.name, path: child.path, size: child.size, ext });
    }
  }

  const lessons: Lesson[] = [];
  const resources: LessonResource[] = [];
  for (const g of byStem.values()) {
    const { order, title } = splitPrefix(g.stem);
    if (g.resourcesDir) {
      g.resources.push(...listFilesRecursive(g.resourcesDir, g.resourcesDir.name));
    }
    if (!g.video && !g.note && g.subtitles.length === 0) {
      // Resources only — not a lesson. They belong to the module.
      resources.push(...g.resources);
      continue;
    }
    lessons.push({
      id: (g.video || g.note || g.subtitles[0]).path,
      name: title,
      order,
      video: g.video || null,
      note: g.note || null,
      subtitles: g.subtitles,
      resources: g.resources,
    });
  }

  lessons.sort(sortByPrefix);
  resources.sort((a, b) => a.name.localeCompare(b.name));
  return { lessons, resources };
}

function dirHasVideosDirectly(dir: MegaTreeNode): boolean {
  return (dir.children || []).some((c) => !c.isDir && VIDEO_EXTS.has(extOf(c.name)));
}

function buildCourse(dir: MegaTreeNode): Course | null {
  const { order, title } = splitPrefix(dir.name);
  const course: Course = {
    id: dir.path || dir.name,
    name: title,
    order,
    description: '',
    modules: [],
  };

  for (const child of dir.children || []) {
    if (!child.isDir || child.name.startsWith('.')) continue;
    const { order: mOrder, title: mTitle } = splitPrefix(child.name);
    const { lessons, resources } = collectLessons(child);
    if (lessons.length === 0 && resources.length === 0) continue;
    course.modules.push({
      id: `${course.id}/${child.name}`,
      name: mTitle,
      order: mOrder,
      lessons,
      resources,
    });
  }

  // Flat layout: videos directly in the course folder. Subdirectories are
  // modules here, so they must not be treated as lesson resource folders.
  const flat = collectLessons(dir, { resourceFolders: false });
  if (flat.lessons.length > 0) {
    course.modules.push({
      id: `${course.id}/Lessons`,
      name: 'Lessons',
      order: 0,
      lessons: flat.lessons,
      resources: flat.resources,
    });
  } else if (flat.resources.length > 0 && course.modules.length === 0) {
    // A course folder with only loose resource files: keep it visible.
    course.modules.push({
      id: `${course.id}/Resources`,
      name: 'Resources',
      order: 0,
      lessons: [],
      resources: flat.resources,
    });
  }

  course.modules.sort(sortByPrefix);
  return course.modules.length > 0 ? course : null;
}

export function buildCatalogue(root: MegaTreeNode): Catalogue {
  const childDirs = (root.children || []).filter((c) => c.isDir && !c.name.startsWith('.'));
  const rootIsCourse =
    dirHasVideosDirectly(root) || childDirs.some((d) => dirHasVideosDirectly(d));

  let courses: Course[] = [];
  if (rootIsCourse) {
    const course = buildCourse(root);
    if (course) courses = [course];
  } else {
    for (const child of childDirs) {
      const course = buildCourse(child);
      if (course) courses.push(course);
    }
  }
  courses.sort(sortByPrefix);
  return { courses, rootName: root.name };
}

export interface SearchEntry {
  lessonId: string;
  course: string;
  module: string;
  lesson: string;
  text: string;
}

export function buildSearchIndex(catalogue: Catalogue): SearchEntry[] {
  const entries: SearchEntry[] = [];
  for (const course of catalogue.courses) {
    for (const mod of course.modules) {
      for (const lesson of mod.lessons) {
        const resourceNames = lesson.resources.map((r) => r.name).join(' ');
        entries.push({
          lessonId: lesson.id,
          course: course.name,
          module: mod.name,
          lesson: lesson.name,
          text: `${course.name} ${mod.name} ${lesson.name} ${resourceNames}`.toLowerCase(),
        });
      }
    }
  }
  return entries;
}

export function countLessons(catalogue: Catalogue): number {
  return catalogue.courses.reduce(
    (n, c) => n + c.modules.reduce((m, mod) => m + mod.lessons.length, 0),
    0,
  );
}

export function countVideos(catalogue: Catalogue): number {
  return catalogue.courses.reduce(
    (n, c) =>
      n +
      c.modules.reduce(
        (m, mod) => m + mod.lessons.filter((l) => l.video).length,
        0,
      ),
    0,
  );
}
