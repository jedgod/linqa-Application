// Driving directions are handed to a navigation app on the phone: Google Maps (Apple Maps on iPhone). That app does the routing and
// the turn-by-turn guidance; Linqa only passes it the destination.

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

async function open(url: string) {
  try { await Linking.openURL(url); }
  catch { Alert.alert('Could not open directions', 'No navigation app or browser was available.'); }
}

/**
 * Opens driving directions to the venue in one step, with no question asked. Google Maps' web link is used on Android: it opens the
 * Google Maps app at the route when installed and the browser otherwise, so it always works. iPhone uses Apple Maps.
 */
export function openDirections(latitude: number, longitude: number, label?: string) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return;
  const urls = directionsUrls(latitude, longitude, label);
  void open(Platform.OS === 'ios' ? urls.system : urls.google);
}
