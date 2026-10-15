// Driving directions are handed to a navigation app on the phone (Google Maps, Waze, Apple Maps...). That app does the routing and
// the turn-by-turn guidance; Linqa only passes it the destination. Nothing is started until the person picks an app.

import { Alert, Linking, Platform } from 'react-native';

const clean = (n: number) => Number(n.toFixed(6));

/** The address each navigation app opens, for a destination. Exported for testing. */
export function directionsUrls(latitude: number, longitude: number, label?: string) {
  const lat = clean(latitude);
  const lon = clean(longitude);
  const name = encodeURIComponent((label ?? '').trim().slice(0, 80));
  return {
    // Opens the phone's own list of map apps on Android; Apple Maps on iPhone.
    system: Platform.OS === 'ios' ? `http://maps.apple.com/?daddr=${lat},${lon}&dirflg=d` : `geo:${lat},${lon}?q=${lat},${lon}${name ? `(${name})` : ''}`,
    google: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`,
    waze: `https://waze.com/ul?ll=${lat},${lon}&navigate=yes`,
  };
}

async function open(url: string, fallback?: string) {
  try { await Linking.openURL(url); }
  catch {
    if (fallback) { try { await Linking.openURL(fallback); return; } catch { /* fall through */ } }
    Alert.alert('Could not open directions', 'No navigation app was available. Try Google Maps or Waze in a browser.');
  }
}

/** Asks which navigation app to use, then opens it with the venue as the destination. */
export function openDirections(latitude: number, longitude: number, label?: string) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return;
  const urls = directionsUrls(latitude, longitude, label);
  Alert.alert('Get directions', label ? `Drive to ${label}` : 'Drive to this location', [
    { text: 'Google Maps', onPress: () => void open(urls.google) },
    { text: 'Waze', onPress: () => void open(urls.waze, urls.google) },
    ...(Platform.OS === 'ios' ? [{ text: 'Apple Maps', onPress: () => void open(urls.system, urls.google) }] : [{ text: 'Other map app', onPress: () => void open(urls.system, urls.google) }]),
    { text: 'Cancel', style: 'cancel' as const },
  ]);
}
