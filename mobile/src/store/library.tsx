// Library state for CourseVault mobile: the Mega link, the loaded catalogue,
// lesson progress, and downloaded files. Provided to every screen via context.
//
// The Mega session (live megajs File objects) lives in a ref and is rebuilt
// whenever the library is loaded or refreshed — catalogue data itself is
// cached in AsyncStorage so the library shows instantly on next launch.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Directory, File } from 'expo-file-system';
import {
  cacheDir,
  downloadMegaFile,
  loadMegaLibrary,
  type LoadedLibrary,
} from '../mega/client';
import {
  buildCatalogue,
  countLessons,
  type Catalogue,
  type Lesson,
} from '../mega/catalogue';
import {
  COMPLETION_THRESHOLD,
  loadCachedCatalogue,
  loadDownloads,
  loadProgress,
  loadSavedLink,
  saveCachedCatalogue,
  saveDownloads,
  saveLink,
  saveProgress,
  type DownloadRecord,
  type LessonProgress,
} from './progress';
import { safeFileName } from '../lib/format';

export const DEFAULT_MEGA_LINK =
  'https://mega.nz/folder/ytZkzaSC#l_VpZ-zplh5xYEm8RN7c2g/folder/qsoFTCBb';

export type LibraryStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface DownloadState {
  state: 'idle' | 'downloading' | 'ready' | 'error';
  received: number;
  total: number;
  error?: string;
}

interface LibraryContextValue {
  status: LibraryStatus;
  error: string | null;
  megaLink: string;
  catalogue: Catalogue | null;
  progress: Record<string, LessonProgress>;
  downloads: Record<string, DownloadRecord>;
  downloadStates: Record<string, DownloadState>;
  lessonCount: number;
  storageUsed: number;
  loadLink: (url: string) => Promise<void>;
  refresh: () => Promise<void>;
  setLessonProgress: (lessonId: string, position: number, duration: number) => void;
  localUriFor: (lesson: Lesson) => Promise<string | null>;
  downloadLesson: (lesson: Lesson) => Promise<string | null>;
  downloadResource: (path: string, name: string) => Promise<string | null>;
  resourceLocalUri: (path: string) => Promise<string | null>;
  openResource: (path: string, name: string) => Promise<void>;
  clearDownloads: () => Promise<void>;
  findLesson: (lessonId: string) => { lesson: Lesson; courseId: string; moduleId: string } | null;
}

const LibraryContext = createContext<LibraryContextValue | null>(null);

export function useLibrary(): LibraryContextValue {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error('useLibrary must be used inside LibraryProvider');
  return ctx;
}

function lessonCacheName(lesson: Lesson): string {
  const ext = lesson.video ? lesson.video.path.split('.').pop() || 'mp4' : 'bin';
  return `${safeFileName(lesson.id)}.${ext}`;
}

function resourceCacheName(path: string): string {
  return `res_${safeFileName(path)}`;
}

export function LibraryProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<LibraryStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [megaLink, setMegaLink] = useState<string>(DEFAULT_MEGA_LINK);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [progress, setProgress] = useState<Record<string, LessonProgress>>({});
  const [downloads, setDownloads] = useState<Record<string, DownloadRecord>>({});
  const [downloadStates, setDownloadStates] = useState<Record<string, DownloadState>>({});
  const sessionRef = useRef<LoadedLibrary | null>(null);
  const downloadingRef = useRef<Set<string>>(new Set());

  // Restore saved state on launch: cached catalogue + progress + downloads.
  useEffect(() => {
    (async () => {
      const [link, cached, prog, dls] = await Promise.all([
        loadSavedLink(),
        loadCachedCatalogue<Catalogue>(),
        loadProgress(),
        loadDownloads(),
      ]);
      if (link) setMegaLink(link);
      if (cached) {
        setCatalogue(cached);
        setStatus('ready');
      }
      setProgress(prog);
      setDownloads(dls);
    })();
  }, []);

  const storageUsed = useMemo(
    () => Object.values(downloads).reduce((n, d) => n + (d.size || 0), 0),
    [downloads],
  );

  const lessonCount = useMemo(() => (catalogue ? countLessons(catalogue) : 0), [catalogue]);

  const loadLink = useCallback(async (url: string) => {
    setStatus('loading');
    setError(null);
    try {
      const session = await loadMegaLibrary(url);
      sessionRef.current = session;
      const cat = buildCatalogue(session.tree);
      setCatalogue(cat);
      setMegaLink(url);
      setStatus('ready');
      await Promise.all([saveLink(url), saveCachedCatalogue(cat)]);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      setStatus('error');
    }
  }, []);

  const refresh = useCallback(async () => {
    await loadLink(megaLink);
  }, [loadLink, megaLink]);

  const setLessonProgress = useCallback((lessonId: string, position: number, duration: number) => {
    setProgress((prev) => {
      const prevEntry = prev[lessonId];
      const completed =
        prevEntry?.completed ||
        (duration > 0 && position / duration >= COMPLETION_THRESHOLD);
      const next = {
        ...prev,
        [lessonId]: { position, duration, completed, updatedAt: Date.now() },
      };
      // Fire-and-forget persistence; the in-memory state is the source of truth.
      saveProgress(next).catch(() => undefined);
      return next;
    });
  }, []);

  const localUriFor = useCallback(
    async (lesson: Lesson): Promise<string | null> => {
      const rec = downloads[lesson.id];
      if (!rec) return null;
      const f = new File(rec.localUri);
      return f.exists ? rec.localUri : null;
    },
    [downloads],
  );

  const ensureSession = useCallback(async (): Promise<LoadedLibrary> => {
    if (sessionRef.current) return sessionRef.current;
    const session = await loadMegaLibrary(megaLink);
    sessionRef.current = session;
    return session;
  }, [megaLink]);

  const downloadLesson = useCallback(
    async (lesson: Lesson): Promise<string | null> => {
      if (!lesson.video) return null;
      const existing = await localUriFor(lesson);
      if (existing) return existing;
      if (downloadingRef.current.has(lesson.id)) return null;
      downloadingRef.current.add(lesson.id);
      setDownloadStates((prev) => ({
        ...prev,
        [lesson.id]: { state: 'downloading', received: 0, total: lesson.video!.size },
      }));
      try {
        const session = await ensureSession();
        const file = session.fileByPath.get(lesson.video.path);
        if (!file) throw new Error('Video file not found in the Mega folder anymore.');
        const dest = `${cacheDir()}${lessonCacheName(lesson)}`;
        const uri = await downloadMegaFile(file, dest, ({ received, total }) => {
          setDownloadStates((prev) => ({
            ...prev,
            [lesson.id]: { state: 'downloading', received, total },
          }));
        });
        const next = {
          ...downloads,
          [lesson.id]: { localUri: uri, size: lesson.video.size, downloadedAt: Date.now() },
        };
        setDownloads(next);
        await saveDownloads(next);
        setDownloadStates((prev) => ({
          ...prev,
          [lesson.id]: { state: 'ready', received: lesson.video!.size, total: lesson.video!.size },
        }));
        return uri;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setDownloadStates((prev) => ({
          ...prev,
          [lesson.id]: { state: 'error', received: 0, total: lesson.video!.size, error: message },
        }));
        return null;
      } finally {
        downloadingRef.current.delete(lesson.id);
      }
    },
    [downloads, ensureSession, localUriFor],
  );

  const resourceLocalUri = useCallback(
    async (path: string): Promise<string | null> => {
      const f = new File(`${cacheDir()}${resourceCacheName(path)}`);
      return f.exists ? f.uri : null;
    },
    [],
  );

  const downloadResource = useCallback(
    async (path: string, name: string): Promise<string | null> => {
      const existing = await resourceLocalUri(path);
      if (existing) return existing;
      try {
        const session = await ensureSession();
        const file = session.fileByPath.get(path);
        if (!file) throw new Error('File not found in the Mega folder anymore.');
        const dest = `${cacheDir()}${resourceCacheName(path)}`;
        return await downloadMegaFile(file, dest);
      } catch {
        return null;
      }
    },
    [ensureSession, resourceLocalUri],
  );

  const openResource = useCallback(
    async (path: string, name: string) => {
      const uri = await downloadResource(path, name);
      if (!uri) throw new Error('Could not download the file from Mega.');
      const f = new File(uri);
      await f.preview({ title: name });
    },
    [downloadResource],
  );

  const clearDownloads = useCallback(async () => {
    const dir = new Directory(cacheDir());
    if (dir.exists) dir.delete();
    setDownloads({});
    await saveDownloads({});
    setDownloadStates({});
  }, []);

  const findLesson = useCallback(
    (lessonId: string) => {
      if (!catalogue) return null;
      for (const course of catalogue.courses) {
        for (const mod of course.modules) {
          const lesson = mod.lessons.find((l) => l.id === lessonId);
          if (lesson) return { lesson, courseId: course.id, moduleId: mod.id };
        }
      }
      return null;
    },
    [catalogue],
  );

  const value: LibraryContextValue = {
    status,
    error,
    megaLink,
    catalogue,
    progress,
    downloads,
    downloadStates,
    lessonCount,
    storageUsed,
    loadLink,
    refresh,
    setLessonProgress,
    localUriFor,
    downloadLesson,
    downloadResource,
    resourceLocalUri,
    openResource,
    clearDownloads,
    findLesson,
  };

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}
