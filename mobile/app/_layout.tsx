import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { LibraryProvider } from '../src/store/library';
import { theme } from '../src/components/ui';

export default function RootLayout() {
  return (
    <LibraryProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.bg },
          headerTintColor: theme.text,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: theme.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'CourseVault' }} />
        <Stack.Screen name="course" options={{ title: 'Course' }} />
        <Stack.Screen name="lesson" options={{ title: 'Lesson' }} />
        <Stack.Screen name="search" options={{ title: 'Search' }} />
      </Stack>
    </LibraryProvider>
  );
}
