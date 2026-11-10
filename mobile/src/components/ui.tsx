// Shared theme + tiny UI pieces for CourseVault mobile.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export const theme = {
  bg: '#0f1115',
  card: '#1a1d24',
  cardPressed: '#22262f',
  border: '#2a2f3a',
  text: '#f3f4f6',
  muted: '#9ca3af',
  accent: '#f59e0b',
  accentText: '#111827',
  success: '#22c55e',
  danger: '#ef4444',
};

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 16 },
  title: { fontSize: 26, fontWeight: '700', color: theme.text },
  subtitle: { fontSize: 14, color: theme.muted, marginTop: 4 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: theme.text, marginTop: 20, marginBottom: 8 },
  card: {
    backgroundColor: theme.card,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: theme.border,
  },
  cardTitle: { fontSize: 16, fontWeight: '600', color: theme.text },
  cardMeta: { fontSize: 13, color: theme.muted, marginTop: 4 },
  button: {
    backgroundColor: theme.accent,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  buttonText: { color: theme.accentText, fontSize: 15, fontWeight: '700' },
  buttonSecondary: {
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  buttonSecondaryText: { color: theme.text, fontSize: 14, fontWeight: '600' },
  input: {
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 10,
    color: theme.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  errorText: { color: theme.danger, fontSize: 14, marginTop: 8 },
  mutedText: { color: theme.muted, fontSize: 14 },
});

export function ProgressBar({ value, height = 6 }: { value: number; height?: number }) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View
      style={{
        height,
        backgroundColor: theme.border,
        borderRadius: height / 2,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          height: '100%',
          width: `${pct * 100}%`,
          backgroundColor: pct >= 1 ? theme.success : theme.accent,
          borderRadius: height / 2,
        }}
      />
    </View>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <View style={{ padding: 24, alignItems: 'center' }}>
      <Text style={{ fontSize: 17, fontWeight: '700', color: theme.text, textAlign: 'center' }}>
        {title}
      </Text>
      <Text style={{ fontSize: 14, color: theme.muted, marginTop: 8, textAlign: 'center' }}>
        {body}
      </Text>
    </View>
  );
}
