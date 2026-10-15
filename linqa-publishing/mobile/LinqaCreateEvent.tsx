import React, { useState } from 'react';
import {
  Alert, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons, MaterialIcons, FontAwesome5 } from '@expo/vector-icons';
import MapView, { Marker } from 'react-native-maps';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';

type Coordinates = { latitude: number; longitude: number };
type Attachment = { uri: string; type: 'image' | 'video'; mimeType?: string };
export type EventPayload = {
  title: string; startsAt: string; location: string; coordinates: Coordinates | null;
  description: string; attachments: Attachment[];
};
type Props = {
  onClose: () => void;
  onPublish: (event: EventPayload) => Promise<void>;
  /** Resolve a selected city/venue through your authenticated backend, not a client API key. */
  resolveLocation?: (query: string) => Promise<Coordinates | null>;
  onTagPeople?: () => void;
  onFeelingActivity?: () => void;
  onGif?: () => void;
};
const purple = '#6041B8';
const initialDate = new Date(2026, 9, 15, 17, 6);

export default function LinqaCreateEvent({
  onClose, onPublish, resolveLocation, onTagPeople, onFeelingActivity, onGif,
}: Props) {
  const [title, setTitle] = useState('');
  const [startsAt, setStartsAt] = useState(initialDate);
  const [picker, setPicker] = useState<'date' | 'time' | null>(null);
  const [location, setLocation] = useState('');
  const [coords, setCoords] = useState<Coordinates | null>(null);
  const [description, setDescription] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [finding, setFinding] = useState(false);

  async function chooseMedia() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { Alert.alert('Permission required', 'Allow photo library access to attach media.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], allowsMultipleSelection: true, quality: 0.8 });
    if (!result.canceled) setAttachments(prev => [...prev, ...result.assets.map(a => ({
      uri: a.uri, type: a.type === 'video' ? 'video' as const : 'image' as const, mimeType: a.mimeType,
    }))]);
  }
  async function lookupLocation() {
    if (!location.trim() || !resolveLocation) return;
    setFinding(true);
    try {
      const result = await resolveLocation(location.trim());
      setCoords(result);
      if (!result) Alert.alert('Location not found', 'Try a more specific city or venue.');
    } catch { Alert.alert('Location unavailable', 'Please try again.'); }
    finally { setFinding(false); }
  }
  async function publish() {
    if (!title.trim()) return Alert.alert('Event title required');
    if (startsAt.getTime() <= Date.now()) return Alert.alert('Choose a future event date and time');
    if (location.trim() && !coords) return Alert.alert('Verify location', 'Select a valid location before posting.');
    if (busy) return;
    setBusy(true);
    try {
      await onPublish({ title: title.trim(), startsAt: startsAt.toISOString(), location: location.trim(), coordinates: coords, description: description.trim(), attachments });
    } catch { Alert.alert('Unable to post', 'Your event was not confirmed. Please retry.'); }
    finally { setBusy(false); }
  }
  const dateText = startsAt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const timeText = startsAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const tools = [
    { label: 'Photo/\nVideo', icon: 'camera' as const, tint: '#D7F4DC', color: '#24964E', action: chooseMedia },
    { label: 'Tag People', icon: 'person-add' as const, tint: '#DDEFFF', color: '#2475C7', action: () => onTagPeople?.() },
    { label: 'Feeling/\nActivity', icon: 'happy-outline' as const, tint: '#FFF5D6', color: '#C7A01A', action: () => onFeelingActivity?.() },
    { label: 'Location', icon: 'location' as const, tint: '#FFE3E5', color: '#D84A59', action: lookupLocation },
    { label: 'GIFs', icon: 'images-outline' as const, tint: '#F1DDF7', color: '#A04BB8', action: () => onGif?.() },
  ];
  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} accessibilityLabel="Close" style={styles.close}><Ionicons name="close" size={26} color="#17151C" /></TouchableOpacity>
        <Text style={styles.heading}>Create Event</Text>
        <TouchableOpacity onPress={publish} disabled={busy || !title.trim()} style={[styles.post, (busy || !title.trim()) && { opacity: 0.6 }]}>
          {busy ? <ActivityIndicator color="white" /> : <Text style={styles.postText}>POST</Text>}
        </TouchableOpacity>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <TextInput style={styles.titleInput} placeholder="Event Title" placeholderTextColor="#777" value={title} onChangeText={setTitle} maxLength={160} />
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Date & Time</Text>
          <View style={styles.dateRow}>
            <TouchableOpacity onPress={() => setPicker('date')} style={[styles.dateChip, { backgroundColor: '#EAE5F8', flex: 1.6 }]}>
              <View style={[styles.circle, { backgroundColor: purple }]}><MaterialIcons name="date-range" size={22} color="white" /></View>
              <View style={styles.chipText}><Text style={styles.chipLabel}>DATE</Text><Text numberOfLines={1} style={styles.chipValue}>{dateText}</Text></View>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setPicker('time')} style={[styles.dateChip, { backgroundColor: '#DDF3F0', flex: 1 }]}>
              <View style={[styles.circle, { backgroundColor: '#238D88' }]}><Ionicons name="time-outline" size={22} color="white" /></View>
              <View style={styles.chipText}><Text style={styles.chipLabel}>TIME</Text><Text numberOfLines={1} style={styles.chipValue}>{timeText}</Text></View>
            </TouchableOpacity>
          </View>
          {picker && <DateTimePicker value={startsAt} mode={picker} display="default" onChange={(event, value) => {
            if (Platform.OS !== 'ios' || event.type === 'dismissed') setPicker(null);
            if (value && event.type !== 'dismissed') setStartsAt(value);
          }} />}
          {picker && Platform.OS === 'ios' && <TouchableOpacity onPress={() => setPicker(null)}><Text style={styles.done}>Done</Text></TouchableOpacity>}
        </View>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Location</Text>
          <View style={styles.mapFrame}>
            {coords ? <MapView style={styles.map} pointerEvents="none" region={{ ...coords, latitudeDelta: 0.025, longitudeDelta: 0.025 }}><Marker coordinate={coords} /></MapView> :
              <View style={styles.mapPlaceholder}><Ionicons name="map-outline" size={28} color="#9A97A6" /><Text style={styles.mapHint}>Search for a city or venue</Text></View>}
            <View style={styles.locationRow}>
              <Ionicons name="location" size={23} color="#2478B7" />
              <TextInput style={styles.locationInput} placeholder="City or Venue" value={location} onChangeText={v => { setLocation(v); setCoords(null); }} onSubmitEditing={lookupLocation} returnKeyType="search" />
              <TouchableOpacity onPress={lookupLocation} disabled={!resolveLocation || finding} accessibilityLabel="Find location">
                {finding ? <ActivityIndicator /> : <Ionicons name="search" size={21} color={purple} />}
              </TouchableOpacity>
            </View>
          </View>
        </View>
        <View style={styles.descriptionWrap}>
          <TextInput style={styles.description} placeholder="Add event description..." placeholderTextColor="#777" multiline value={description} onChangeText={setDescription} maxLength={5000} textAlignVertical="top" />
          <Text style={styles.counter}>{description.length}/5000</Text>
        </View>
        {attachments.length > 0 && <Text style={styles.attached}>{attachments.length} media attachment(s) selected</Text>}
      </ScrollView>
      <View style={styles.toolbar}>{tools.map(t => <TouchableOpacity key={t.label} style={styles.tool} onPress={t.action} accessibilityLabel={t.label.replace('\n', ' ')}>
        <View style={[styles.toolIcon, { backgroundColor: t.tint }]}><Ionicons name={t.icon} size={23} color={t.color} /></View>
        <Text style={styles.toolLabel}>{t.label}</Text>
      </TouchableOpacity>)}</View>
    </KeyboardAvoidingView>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8F8F6' },
  header: { height: 72, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  close: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#EEEEEC', justifyContent: 'center', alignItems: 'center' },
  heading: { fontSize: 20, fontWeight: '700', color: '#19151F' },
  post: { backgroundColor: purple, borderRadius: 26, minWidth: 96, paddingVertical: 12, alignItems: 'center', elevation: 4 },
  postText: { color: 'white', fontSize: 16, fontWeight: '700' },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16, gap: 14 },
  titleInput: { backgroundColor: '#F0F0EF', borderWidth: 1, borderColor: '#D2D2D0', borderRadius: 17, height: 60, paddingHorizontal: 18, fontSize: 18, color: '#19151F' },
  card: { backgroundColor: 'white', borderRadius: 18, padding: 14, elevation: 3, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 7, shadowOffset: { width: 0, height: 3 } },
  cardTitle: { fontSize: 19, fontWeight: '700', color: '#1C1820', marginBottom: 12 },
  dateRow: { flexDirection: 'row', gap: 8 },
  dateChip: { flexDirection: 'row', alignItems: 'center', minWidth: 0, borderRadius: 14, padding: 10, gap: 8 },
  circle: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  chipText: { flex: 1, minWidth: 0 }, chipLabel: { fontSize: 11, fontWeight: '700' }, chipValue: { fontSize: 14, fontWeight: '700', color: '#18151D' },
  done: { color: purple, fontWeight: '700', textAlign: 'right', paddingTop: 8 },
  mapFrame: { borderRadius: 15, overflow: 'hidden', borderWidth: 1, borderColor: '#DADADA' },
  map: { height: 70, width: '100%' },
  mapPlaceholder: { height: 70, backgroundColor: '#E9EBE8', flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center' },
  mapHint: { color: '#77727F', fontSize: 12 },
  locationRow: { height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 10, backgroundColor: 'white' },
  locationInput: { flex: 1, fontSize: 16, color: '#201C24' },
  descriptionWrap: { borderRadius: 17, borderWidth: 1, borderColor: '#D2D2D0', backgroundColor: '#F1F1EF', minHeight: 98, padding: 14 },
  description: { minHeight: 55, fontSize: 16, color: '#201C24' }, counter: { textAlign: 'right', color: '#6C6870', fontSize: 12 },
  attached: { fontSize: 13, color: purple },
  toolbar: { flexDirection: 'row', justifyContent: 'space-around', backgroundColor: 'white', paddingTop: 9, paddingBottom: 12, borderTopWidth: 1, borderTopColor: '#E4E4E4' },
  tool: { flex: 1, alignItems: 'center', gap: 4 }, toolIcon: { width: 42, height: 42, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  toolLabel: { fontSize: 10, fontWeight: '600', color: '#2A2730', textAlign: 'center', minHeight: 26 },
});
