// The supplied adapter (linqa-publishing/mobile/app/CreateEventConnected.tsx) joining the create screen to the publishing
// backend, with this app's additions: a place lookup that runs on the phone (no map-provider key in the app), the screen
// title, and a callback so a published item can be added to the person's own events.
import React from 'react';
import { Alert } from 'react-native';
import * as Location from 'expo-location';
import * as FileSystem from 'expo-file-system/legacy';
import { PlainLocationMap } from './PlainLocationMap';
import { adoptCapture } from '../../services/conversation-media';
import LinqaCreateEvent, { type EventPayload } from './LinqaCreateEvent';
import { ChatInboxService } from '../../services/chat-inbox.service';
import { getApiBaseUrl } from '../../config/api';
import { accessTokenProvider } from '../../services/session';
import { publishOrQueue, type PublishingConfig } from '../../lib/publishing/publishing';

/** Finds a city or venue with the phone's own geocoder. Returns null when nothing matches. */
async function resolveLocation(query: string) {
  const found = await Location.geocodeAsync(query);
  const first = found[0];
  return first ? { latitude: first.latitude, longitude: first.longitude } : null;
}

/** The people this person can tag: everyone they have a one-to-one chat with. */
async function loadPeople() {
  const inbox = new ChatInboxService(getApiBaseUrl(), () => accessTokenProvider.getAccessToken());
  const data = await inbox.inbox('all');
  const seen = new Set<string>();
  return data.conversations.flatMap((c) => {
    if (c.isGroup || !c.peerUserId || seen.has(c.peerUserId)) return [];
    seen.add(c.peerUserId);
    return [{ id: c.peerUserId, name: c.title }];
  });
}

/** Where the phone is now, with a readable place name. Null when location access is off. */
async function currentPlace() {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) return null;
  const here = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  const [place] = await Location.reverseGeocodeAsync(here.coords).catch(() => []);
  const label = [place?.name && place.name !== place.city ? place.name : null, place?.city, place?.region].filter(Boolean).join(', ') || 'Current location';
  return { coordinates: { latitude: here.coords.latitude, longitude: here.coords.longitude }, label };
}

/** Moves a picked file out of the picker's cache, which Android clears on its own, into the app's permanent storage. */
async function keepFile(uri: string, type: 'image' | 'video', base64?: string | null, ext?: 'gif') {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  if (type === 'image') {
    // The picker's own file can be cleared by Android within moments, so the image data it handed over is used when present.
    if (base64) {
      const target = `${FileSystem.documentDirectory}linqa-publish-${stamp}.${ext ?? 'jpg'}`;
      await FileSystem.writeAsStringAsync(target, base64, { encoding: FileSystem.EncodingType.Base64 });
      const info = await FileSystem.getInfoAsync(target);
      if (!info.exists || !('size' in info) || !info.size) throw new Error('The photo was not saved.');
      return target;
    }
    return adoptCapture(uri, 'jpg');
  }
  // Videos can be large, so they are copied by the file system rather than read into memory.
  const target = `${FileSystem.documentDirectory}linqa-publish-${stamp}.mp4`;
  await FileSystem.copyAsync({ from: uri, to: target });
  const info = await FileSystem.getInfoAsync(target);
  if (!info.exists || !('size' in info) || !info.size) throw new Error('The video was not saved.');
  return target;
}

export type PublishedInfo = { localId: string; remoteId?: string | null; payload: EventPayload };

export default function CreateEventConnected({ config, onClose, heading, onPublished }: {
  config: PublishingConfig;
  onClose: () => void;
  heading?: string;
  /** Called only when the server confirmed the item; queued (offline) items are reported later by the sync. */
  onPublished?: (info: PublishedInfo) => void | Promise<void>;
}) {
  return <LinqaCreateEvent onClose={onClose} heading={heading} resolveLocation={resolveLocation} keepFile={keepFile} loadPeople={loadPeople} currentPlace={currentPlace} renderMap={(coords, place) => <PlainLocationMap latitude={coords.latitude} longitude={coords.longitude} height={200} label={place} />} onPublish={async event => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const result = await publishOrQueue(config, event, timezone);
    const noun = (heading ?? 'event').toLowerCase().includes('post') ? 'post' : 'event';
    if (result.status === 'published') {
      Alert.alert('Published', `Your ${noun} is live.`);
      await onPublished?.({ localId: result.localId, payload: event });
    } else if (result.status === 'pending') Alert.alert('Saved offline', `Your ${noun} is pending synchronization.`);
    else Alert.alert('Action required', result.error || `Please review the ${noun}.`);
    onClose();
  }} />;
}
