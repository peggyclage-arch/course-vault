// Search across lesson titles, module/course names and resource file names.

import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useLibrary } from '../src/store/library';
import { buildSearchIndex } from '../src/mega/catalogue';
import { EmptyState, styles, theme } from '../src/components/ui';

export default function SearchScreen() {
  const lib = useLibrary();
  const [query, setQuery] = useState('');

  const index = useMemo(
    () => (lib.catalogue ? buildSearchIndex(lib.catalogue) : []),
    [lib.catalogue],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return index.filter((e) => e.text.includes(q)).slice(0, 50);
  }, [query, index]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <TextInput
        style={styles.input}
        value={query}
        onChangeText={setQuery}
        placeholder="Search lessons… (try “hook”, “brief”, “offer”)"
        placeholderTextColor={theme.muted}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
      />

      {!lib.catalogue && (
        <EmptyState
          title="No library loaded yet"
          body="Go back and load a Mega folder link first, then search here."
        />
      )}

      {lib.catalogue && query.trim().length >= 2 && results.length === 0 && (
        <EmptyState title="No matches" body={`Nothing matched "${query.trim()}" in this library.`} />
      )}

      {results.map((r) => (
        <Pressable
          key={r.lessonId}
          style={styles.card}
          onPress={() =>
            router.push({
              pathname: '/lesson',
              params: { lessonId: encodeURIComponent(r.lessonId) },
            })
          }
        >
          <Text style={styles.cardTitle}>{r.lesson}</Text>
          <Text style={styles.cardMeta}>
            {r.course} › {r.module}
          </Text>
        </Pressable>
      ))}

      {lib.catalogue && query.trim().length < 2 && (
        <View style={{ marginTop: 16 }}>
          <Text style={styles.mutedText}>
            {index.length} lessons indexed. Type at least 2 characters to search.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}
