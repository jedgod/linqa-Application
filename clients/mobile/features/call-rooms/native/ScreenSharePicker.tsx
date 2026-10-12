/**
 * iOS starts a screen broadcast only from the system picker. This keeps an
 * invisible picker mounted in the call screen and taps it programmatically
 * (react-native-webrtc's documented approach) after the user confirms Share.
 */
import React, { useEffect, useRef } from 'react';
import { findNodeHandle, NativeModules, Platform, StyleSheet } from 'react-native';
import { ScreenCapturePickerView } from 'react-native-webrtc';

let pickerTag: number | null = null;

export function ScreenSharePicker() {
  const ref = useRef(null);
  useEffect(() => {
    pickerTag = findNodeHandle(ref.current);
    return () => {
      pickerTag = null;
    };
  }, []);
  if (Platform.OS !== 'ios') return null;
  const Picker = ScreenCapturePickerView as unknown as React.ComponentType<{ ref: unknown; style: unknown }>;
  return <Picker ref={ref} style={st.hidden} />;
}

/** Opens the system "Start Broadcast" sheet with Linqa's extension preselected. */
export function showBroadcastPicker(): boolean {
  if (Platform.OS !== 'ios' || pickerTag == null) return false;
  NativeModules.ScreenCapturePickerViewManager?.show(pickerTag);
  return true;
}

const st = StyleSheet.create({ hidden: { position: 'absolute', width: 1, height: 1, opacity: 0 } });
