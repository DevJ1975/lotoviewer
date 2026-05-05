import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { useColorScheme } from '@/components/useColorScheme';
import { AuthProvider } from '@/components/AuthProvider';
import { TenantProvider } from '@/components/TenantProvider';
import AuthGate from '@/components/AuthGate';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <AuthProvider>
      <TenantProvider>
        <RootLayoutNav />
      </TenantProvider>
    </AuthProvider>
  );
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthGate>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="forgot-password" options={{ title: 'Reset password' }} />
          <Stack.Screen name="equipment/[id]" options={{ title: 'Equipment' }} />
          <Stack.Screen name="near-miss/new" options={{ title: 'Report Near-Miss', presentation: 'modal' }} />
          <Stack.Screen name="near-miss/[id]" options={{ title: 'Near-Miss' }} />
          <Stack.Screen name="jha/new" options={{ title: 'New JHA', presentation: 'modal' }} />
          <Stack.Screen name="jha/[id]" options={{ title: 'JHA' }} />
          <Stack.Screen name="tenant-switcher" options={{ presentation: 'modal', title: 'Switch tenant' }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
        </Stack>
      </AuthGate>
    </ThemeProvider>
  );
}
