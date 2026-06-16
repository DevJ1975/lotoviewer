import * as Location from 'expo-location'

// Thin wrapper over expo-location for the Safety Weather Board. The board needs
// one coordinate to fetch site weather; this collapses expo-location's
// permission + position flow into a single discriminated result so the screen
// can branch without touching the native API or its error shapes.

export interface SiteCoordinates {
  latitude: number
  longitude: number
}

export type LocationResult =
  | { status: 'granted'; coordinates: SiteCoordinates }
  | { status: 'denied' }
  | { status: 'unavailable' }

/**
 * Request foreground location permission and, if granted, read the current
 * position. Returns 'denied' when the user refuses permission and 'unavailable'
 * for any other failure (location services off, GPS timeout, simulator).
 */
export async function getCurrentSiteCoordinates(): Promise<LocationResult> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync()
    if (status !== 'granted') return { status: 'denied' }

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    })
    return {
      status: 'granted',
      coordinates: {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      },
    }
  } catch {
    return { status: 'unavailable' }
  }
}
