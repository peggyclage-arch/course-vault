// Library screen: paste a Mega folder link, load the catalogue, browse courses.
// The default link is Soufian's "Ecom University - Creative Strategy" folder.

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useLibrary } from '../src/store/library';
import { isCompleted } from '../src/store/progress';
import { formatSize } from '../src/lib/format';
import { EmptyState, ProgressBar, styles, theme } from '../src/components/ui';

export default function LibraryScreen() {
  const lib = useLibrary();
  const [link, setLink] = useState(lib.megaLink);
  const [clearing, setClearing] = useState(false);

  const courseProgress = useMemo(() => {
    if (!lib.catalogue) return {};
    const out: Record<string, { done: number; total: number }> = {};
    for (const course of lib.catalogue.courses) {
      let done = 0;
      let total = 0;
      for (const mod of course.modules) {
        for (const lesson of mod.lessons) {
          total += 1;
          if (isCompleted(lib.progress[lesson.id])) done += 1;
        }
      }
      out[course.id] = { done, total };
    }
    return out;
  }, [lib.catalogue, lib.progress]);

  const onLoad = () => {
    if (!link.trim()) return;
    lib.loadLink(link.trim());
  };

  const onClearDownloads = () => {
    Alert.alert(
      'Clear downloads',
      `Delete all downloaded lessons (${formatSize(lib.storageUsed)}) from this phone? Your progress is kept.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setClearing(true);
            await lib.clearDownloads();
            setClearing(false);
          },
        },
      ],
    );
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>CourseVault</Text>
      <Text style={styles.subtitle}>
        Your courses, straight from a Mega folder. No account, no cloud of ours — progress stays on
        this phone.
      </Text>

      <Text style={styles.sectionTitle}>Mega folder link</Text>
      <TextInput
        style={[styles.input, { minHeight: 64 }]}
        value={link}
        onChangeText={setLink}
        placeholder="https://mega.nz/folder/…"
        placeholderTextColor={theme.muted}
        autoCapitalize="none"
        autoCorrect={false}
        multiline
      />
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
        <TouchableOpacity
          style={[styles.button, { flex: 1 }]}
          onPress={onLoad}
          disabled={lib.status === 'loading'}
        >
          <Text style={styles.buttonText}>
            {lib.status === 'loading' ? 'Loading…' : 'Load library'}
          </Text>
        </TouchableOpacity>
        {lib.catalogue && (
          <TouchableOpacity style={styles.buttonSecondary} onPress={lib.refresh}>
            <Text style={styles.buttonSecondaryText}>Refresh</Text>
          </TouchableOpacity>
        )}
      </View>

      {lib.status === 'loading' && (
        <View style={{ marginTop: 20, alignItems: 'center' }}>
          <ActivityIndicator color={theme.accent} />
          <Text style={[styles.mutedText, { marginTop: 8 }]}>Reading the Mega folder…</Text>
        </View>
      )}

      {lib.status === 'error' && (
        <View style={{ marginTop: 12 }}>
          <Text style={styles.errorText}>Could not load that folder: {lib.error}</Text>
          <Text style={[styles.mutedText, { marginTop: 6 }]}>
            Check the link — it needs to be a public Mega folder link (mega.nz/folder/…).
          </Text>
        </View>
      )}

      {lib.catalogue && lib.catalogue.courses.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>
            Courses · {lib.catalogue.courses.length} course
            {lib.catalogue.courses.length === 1 ? '' : 's'} · {lib.lessonCount} lessons
          </Text>
          {lib.catalogue.courses.map((course) => {
            const p = courseProgress[course.id] || { done: 0, total: 0 };
            const pct = p.total > 0 ? p.done / p.total : 0;
            const lessonCount = course.modules.reduce((n, m) => n + m.lessons.length, 0);
            return (
              <Pressable
                key={course.id}
                style={styles.card}
                onPress={() =>
                  router.push({
                    pathname: '/course',
                    params: { courseId: encodeURIComponent(course.id) },
                  })
                }
              >
                <Text style={styles.cardTitle}>{course.name}</Text>
                <Text style={styles.cardMeta}>
                  {course.modules.length} modules · {lessonCount} lessons
                </Text>
                <View style={{ marginTop: 10 }}>
                  <ProgressBar value={pct} />
                  <Text style={[styles.cardMeta, { marginTop: 4 }]}>
                    {p.done} of {p.total} lessons done
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </>
      )}

      {lib.status === 'ready' && lib.catalogue && lib.catalogue.courses.length === 0 && (
        <EmptyState
          title="No courses found"
          body={`The folder "${lib.catalogue.rootName}" has no video lessons in it. Try a link to a folder that contains courses, or a course folder itself.`}
        />
      )}

      <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
        <TouchableOpacity style={styles.buttonSecondary} onPress={() => router.push('/search')}>
          <Text style={styles.buttonSecondaryText}>🔍 Search lessons</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.buttonSecondary}
          onPress={onClearDownloads}
          disabled={clearing || lib.storageUsed === 0}
        >
          <Text style={styles.buttonSecondaryText}>
            {clearing
              ? 'Clearing…'
              : lib.storageUsed > 0
                ? `Clear downloads (${formatSize(lib.storageUsed)})`
                : 'No downloads yet'}
          </Text>
        </TouchableOpacity>
      </View>

      <Text style={[styles.mutedText, { marginTop: 24, textAlign: 'center' }]}>
        CourseVault mobile v1 · videos download from Mega and play offline
      </Text>
    </ScrollView>
  );
}
