// Course screen: modules and lessons of one course, with progress.

import React, { useMemo } from 'react';
import { Pressable, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useLibrary } from '../src/store/library';
import { isCompleted } from '../src/store/progress';
import { formatSize, formatTime } from '../src/lib/format';
import { EmptyState, ProgressBar, styles, theme } from '../src/components/ui';

export default function CourseScreen() {
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  const lib = useLibrary();
  const course = useMemo(() => {
    if (!lib.catalogue || !courseId) return null;
    const id = decodeURIComponent(courseId);
    return lib.catalogue.courses.find((c) => c.id === id) || null;
  }, [lib.catalogue, courseId]);

  const totals = useMemo(() => {
    if (!course) return { done: 0, total: 0 };
    let done = 0;
    let total = 0;
    for (const mod of course.modules) {
      for (const lesson of mod.lessons) {
        total += 1;
        if (isCompleted(lib.progress[lesson.id])) done += 1;
      }
    }
    return { done, total };
  }, [course, lib.progress]);

  if (!course) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <EmptyState title="Course not found" body="Go back and reload the library." />
      </ScrollView>
    );
  }

  const pct = totals.total > 0 ? totals.done / totals.total : 0;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{course.name}</Text>
      <Text style={styles.subtitle}>
        {course.modules.length} modules · {totals.total} lessons
      </Text>
      <View style={{ marginTop: 12 }}>
        <ProgressBar value={pct} />
        <Text style={[styles.cardMeta, { marginTop: 4 }]}>
          {totals.done} of {totals.total} lessons done
        </Text>
      </View>

      {course.modules.map((mod) => (
        <View key={mod.id}>
          <Text style={styles.sectionTitle}>{mod.name}</Text>
          {mod.lessons.map((lesson) => {
            const p = lib.progress[lesson.id];
            const done = isCompleted(p);
            const resume = p && !done && p.position > 5 ? p.position : 0;
            const downloaded = Boolean(lib.downloads[lesson.id]);
            return (
              <Pressable
                key={lesson.id}
                style={styles.card}
                onPress={() =>
                  router.push({
                    pathname: '/lesson',
                    params: { lessonId: encodeURIComponent(lesson.id) },
                  })
                }
              >
                <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                  <Text
                    style={{
                      fontSize: 16,
                      fontWeight: '700',
                      color: done ? theme.success : theme.accent,
                      marginRight: 8,
                    }}
                  >
                    {done ? '✓' : '▶'}
                  </Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{lesson.name}</Text>
                    <Text style={styles.cardMeta}>
                      {lesson.video ? formatSize(lesson.video.size) : 'No video'}
                      {downloaded ? ' · downloaded' : ''}
                      {lesson.subtitles.length > 0 ? ' · subtitles' : ''}
                      {lesson.note ? ' · notes' : ''}
                      {lesson.resources.length > 0
                        ? ` · ${lesson.resources.length} file${lesson.resources.length === 1 ? '' : 's'}`
                        : ''}
                    </Text>
                    {resume > 0 && (
                      <Text style={[styles.cardMeta, { color: theme.accent }]}>
                        Resume at {formatTime(resume)}
                      </Text>
                    )}
                    {p && p.duration > 0 && !done && (
                      <View style={{ marginTop: 8 }}>
                        <ProgressBar value={p.position / p.duration} height={4} />
                      </View>
                    )}
                  </View>
                </View>
              </Pressable>
            );
          })}
          {mod.resources.length > 0 && (
            <View style={[styles.card, { borderStyle: 'dashed' }]}>
              <Text style={[styles.cardTitle, { fontSize: 14 }]}>Module files</Text>
              {mod.resources.map((r) => (
                <TouchableOpacity
                  key={r.path}
                  onPress={() => lib.openResource(r.path, r.name).catch(() => undefined)}
                  style={{ marginTop: 8 }}
                >
                  <Text style={{ color: theme.accent, fontSize: 14 }}>
                    📄 {r.name} · {formatSize(r.size)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      ))}
    </ScrollView>
  );
}
