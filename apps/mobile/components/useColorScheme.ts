import { useColorScheme as useRNColorScheme } from 'react-native'

// React Native (SDK 57 / RN 0.86) widened useColorScheme()'s return type to
// include 'unspecified' alongside 'light' | 'dark' | null. This app themes only
// light vs dark, so collapse anything that isn't an explicit dark preference to
// 'light' — keeping the return type a clean 'light' | 'dark' that can index the
// Colors map directly, and matching useColorScheme.web.ts.
export function useColorScheme(): 'light' | 'dark' {
  return useRNColorScheme() === 'dark' ? 'dark' : 'light'
}
