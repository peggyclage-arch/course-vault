// Local persistence for CourseVault mobile: progress, downloads, saved link.
// Everything lives on the phone (AsyncStorage + cache dir). No accounts,
// no cloud of our own.

import AsyncStorage from '@react-native-async-storage/async-storage';

export interface LessonProgress {
  position: number; // seconds last watched
  duration: number; // seconds, 0 when unknown
  completed: boolean;
  updatedAt: number;
}

export interface DownloadRecord {
  localUri: string;
  size: number;
  downloadedAt: number;
}

const KEYS = {
  megaLink: 'cv:megaLink',
  catalogue: 'cv:catalogue',
  progress: 'cv:progress',
  downloads: 'cv:downloads',
};

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

export async function loadSavedLink(): Promise<string | null> {
  return AsyncStorage.getItem(KEYS.megaLink);
}

export async function saveLink(link: string): Promise<void> {
  await AsyncStorage.setItem(KEYS.megaLink, link);
}

export async function loadCachedCatalogue<T>(): Promise<T | null> {
  return readJson<T | null>(KEYS.catalogue, null);
}

export async function saveCachedCatalogue(catalogue: unknown): Promise<void> {
  await writeJson(KEYS.catalogue, catalogue);
}

export async function loadProgress(): Promise<Record<string, LessonProgress>> {
  return readJson<Record<string, LessonProgress>>(KEYS.progress, {});
}

export async function saveProgress(map: Record<string, LessonProgress>): Promise<void> {
  await writeJson(KEYS.progress, map);
}

export async function loadDownloads(): Promise<Record<string, DownloadRecord>> {
  return readJson<Record<string, DownloadRecord>>(KEYS.downloads, {});
}

export async function saveDownloads(map: Record<string, DownloadRecord>): Promise<void> {
  await writeJson(KEYS.downloads, map);
}

/** A lesson counts as completed once 90% of it has been watched. */
export const COMPLETION_THRESHOLD = 0.9;

export function isCompleted(p: LessonProgress | undefined): boolean {
  if (!p) return false;
  if (p.completed) return true;
  return p.duration > 0 && p.position / p.duration >= COMPLETION_THRESHOLD;
}
