// Lesson screen: video player (resume, progress, subtitles), notes, resources.
//
// Video playback is download-then-play: Mega files are encrypted, so the
// lesson downloads (decrypted by megajs) into the phone cache first, then
// plays from the local file. Downloaded lessons play offline.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useEvent, useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { File } from 'expo-file-system';
import { useLibrary } from '../src/store/library';
import { isCompleted } from '../src/store/progress';
import { formatSize, formatTime } from '../src/lib/format';
import { cueAt, parseSrt, type SubtitleCue } from '../src/lib/srt';
import { EmptyState, ProgressBar, styles, theme } from '../src/components/ui';

type Tab = 'notes' | 'files';

function LessonPlayer({
  uri,
  resumeAt,
  duration,
  lessonId,
  cues,
  onPosition,
}: {
  uri: string;
  resumeAt: number;
  duration: number;
  lessonId: string;
  cues: SubtitleCue[];
  onPosition: (position: number, dur: number) => void;
}) {
  const seekDone = useRef(false);
  const [currentCue, setCurrentCue] = useState<SubtitleCue | null>(null);
  const cuesRef = useRef<SubtitleCue[]>([]);
  const [subtitlesOn, setSubtitlesOn] = useState(true);

  useEffect(() => {
    cuesRef.current = cues;
  }, [cues]);

  const player = useVideoPlayer(uri, (p) => {
    p.timeUpdateEventInterval = 0.5;
  });

  const { status } = useEvent(player, 'statusChange', { status: player.status });

  // Seek to the saved position once the player is ready, then play.
  useEffect(() => {
    if (status === 'readyToPlay' && !seekDone.current) {
      seekDone.current = true;
      if (resumeAt > 5 && (duration === 0 || resumeAt < duration - 5)) {
        player.currentTime = resumeAt;
      }
      player.play();
    }
  }, [status, resumeAt, duration, player]);

  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    onPosition(currentTime, player.duration || 0);
    if (subtitlesOn) {
      setCurrentCue(cueAt(cuesRef.current, currentTime));
    }
  });

  return (
    <View>
      <View style={{ position: 'relative', backgroundColor: '#000', borderRadius: 12, overflow: 'hidden' }}>
        <VideoView
          style={{ width: '100%', aspectRatio: 16 / 9 }}
          player={player}
          fullscreenOptions={{ enable: true }}
          allowsPictureInPicture
          nativeControls
        />
        {subtitlesOn && currentCue && (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: 12,
              right: 12,
              bottom: 12,
              alignItems: 'center',
            }}
          >
            <Text
              style={{
                backgroundColor: 'rgba(0,0,0,0.75)',
                color: '#fff',
                fontSize: 16,
                paddingHorizontal: 8,
                paddingVertical: 4,
                borderRadius: 4,
                textAlign: 'center',
              }}
            >
              {currentCue.text}
            </Text>
          </View>
        )}
      </View>
      <Text style={[styles.cardMeta, { marginTop: 6 }]}>
        Lesson {lessonId.split('/').pop()} · {status}
      </Text>
      {cues.length > 0 && (
        <TouchableOpacity onPress={() => setSubtitlesOn((v) => !v)} style={{ marginTop: 4 }}>
          <Text style={{ color: theme.accent, fontSize: 14 }}>
            Subtitles: {subtitlesOn ? 'on' : 'off'} ({cues.length} cues)
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

export default function LessonScreen() {
  const { lessonId } = useLocalSearchParams<{ lessonId: string }>();
  const lib = useLibrary();
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [tab, setTab] = useState<Tab>('notes');
  const [noteText, setNoteText] = useState<string | null>(null);
  const [noteLoading, setNoteLoading] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [subtitleCues, setSubtitleCues] = useState<SubtitleCue[]>([]);
  const lastSavedRef = useRef(0);

  const found = useMemo(() => {
    if (!lessonId) return null;
    return lib.findLesson(decodeURIComponent(lessonId));
  }, [lessonId, lib]);
  const lesson = found?.lesson || null;

  const saved = lesson ? lib.progress[lesson.id] : undefined;
  const resumeAt = saved && !isCompleted(saved) ? saved.position : 0;
  const dl = lesson ? lib.downloadStates[lesson.id] : undefined;

  // Is this lesson already downloaded?
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!lesson) return;
      setChecking(true);
      const uri = await lib.localUriFor(lesson);
      if (alive) {
        setLocalUri(uri);
        setChecking(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [lesson, lib]);

  // Load subtitles (if any) once the lesson is known.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!lesson || lesson.subtitles.length === 0) return;
      const sub = lesson.subtitles[0];
      const uri = await lib.downloadResource(sub.path, sub.path.split('/').pop() || 'sub.srt');
      if (!uri || !alive) return;
      try {
        const text = await new File(uri).text();
        if (alive) setSubtitleCues(parseSrt(text));
      } catch {
        // Subtitles are best-effort; the lesson still plays without them.
      }
    })();
    return () => {
      alive = false;
    };
  }, [lesson, lib]);

  const savePosition = (position: number, dur: number) => {
    if (!lesson) return;
    // Throttle: save at most every 5s of playback (plus on pause/unmount).
    if (Math.abs(position - lastSavedRef.current) < 5 && position > 0) return;
    lastSavedRef.current = position;
    lib.setLessonProgress(lesson.id, position, dur);
  };

  const onDownload = async () => {
    if (!lesson) return;
    const uri = await lib.downloadLesson(lesson);
    if (uri) setLocalUri(uri);
  };

  const loadNote = async () => {
    if (!lesson?.note) return;
    setNoteLoading(true);
    setNoteError(null);
    try {
      const uri = await lib.downloadResource(lesson.note.path, lesson.note.path.split('/').pop() || 'note');
      if (!uri) throw new Error('Could not download the note.');
      const text = await new File(uri).text();
      setNoteText(text);
    } catch (e) {
      setNoteError(e instanceof Error ? e.message : String(e));
    } finally {
      setNoteLoading(false);
    }
  };

  if (!lesson) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <EmptyState title="Lesson not found" body="Go back and reload the library." />
      </ScrollView>
    );
  }

  const done = isCompleted(saved);
  const progressValue =
    saved && saved.duration > 0 ? saved.position / saved.duration : 0;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{lesson.name}</Text>
      <Text style={styles.subtitle}>
        {done ? '✓ Completed' : resumeAt > 0 ? `Resume at ${formatTime(resumeAt)}` : 'Not started yet'}
        {lesson.video ? ` · ${formatSize(lesson.video.size)}` : ''}
      </Text>
      <View style={{ marginTop: 10 }}>
        <ProgressBar value={progressValue} />
      </View>

      <View style={{ marginTop: 16 }}>
        {lesson.video ? (
          checking ? (
            <View style={{ alignItems: 'center', padding: 24 }}>
              <ActivityIndicator color={theme.accent} />
            </View>
          ) : localUri ? (
            <LessonPlayer
              uri={localUri}
              resumeAt={resumeAt}
              duration={saved?.duration || 0}
              lessonId={lesson.id}
              cues={subtitleCues}
              onPosition={savePosition}
            />
          ) : (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Download to watch</Text>
              <Text style={styles.cardMeta}>
                Videos download from Mega first (they are encrypted on Mega), then play from this
                phone — including offline. {formatSize(lesson.video.size)} · kept in the app cache
                until you clear downloads.
              </Text>
              {dl?.state === 'downloading' ? (
                <View style={{ marginTop: 12 }}>
                  <ProgressBar value={dl.total > 0 ? dl.received / dl.total : 0} />
                  <Text style={[styles.cardMeta, { marginTop: 6 }]}>
                    Downloading… {formatSize(dl.received)} of {formatSize(dl.total)}
                  </Text>
                </View>
              ) : (
                <TouchableOpacity style={[styles.button, { marginTop: 12 }]} onPress={onDownload}>
                  <Text style={styles.buttonText}>Download &amp; play</Text>
                </TouchableOpacity>
              )}
              {dl?.state === 'error' && (
                <Text style={styles.errorText}>Download failed: {dl.error}</Text>
              )}
            </View>
          )
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>No video for this lesson</Text>
            <Text style={styles.cardMeta}>This lesson is notes and files only.</Text>
          </View>
        )}
      </View>

      {/* Notes / files tabs */}
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
        <TouchableOpacity
          style={tab === 'notes' ? styles.button : styles.buttonSecondary}
          onPress={() => setTab('notes')}
        >
          <Text style={tab === 'notes' ? styles.buttonText : styles.buttonSecondaryText}>Notes</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={tab === 'files' ? styles.button : styles.buttonSecondary}
          onPress={() => setTab('files')}
        >
          <Text style={tab === 'files' ? styles.buttonText : styles.buttonSecondaryText}>
            Files ({lesson.resources.length})
          </Text>
        </TouchableOpacity>
      </View>

      {tab === 'notes' && (
        <View style={{ marginTop: 12 }}>
          {lesson.note ? (
            noteText === null ? (
              <TouchableOpacity style={styles.buttonSecondary} onPress={loadNote} disabled={noteLoading}>
                <Text style={styles.buttonSecondaryText}>
                  {noteLoading ? 'Loading note…' : `Read note (${lesson.note.path.split('/').pop()})`}
                </Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.card}>
                <Text style={{ color: theme.text, fontSize: 14, lineHeight: 21 }}>{noteText}</Text>
              </View>
            )
          ) : (
            <Text style={styles.mutedText}>No note file for this lesson.</Text>
          )}
          {noteError && <Text style={styles.errorText}>{noteError}</Text>}
          {subtitleCues.length > 0 && (
            <Text style={[styles.cardMeta, { marginTop: 12 }]}>
              Subtitles available ({subtitleCues.length} cues) — they show over the video while
              it plays.
            </Text>
          )}
        </View>
      )}

      {tab === 'files' && (
        <View style={{ marginTop: 12 }}>
          {lesson.resources.length === 0 ? (
            <Text style={styles.mutedText}>No files attached to this lesson.</Text>
          ) : (
            lesson.resources.map((r) => (
              <TouchableOpacity
                key={r.path}
                style={styles.card}
                onPress={() => lib.openResource(r.path, r.name).catch(() => undefined)}
              >
                <Text style={styles.cardTitle}>📄 {r.name}</Text>
                <Text style={styles.cardMeta}>{formatSize(r.size)} · tap to open</Text>
              </TouchableOpacity>
            ))
          )}
        </View>
      )}
    </ScrollView>
  );
}
