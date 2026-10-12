import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import type { CallEngine } from '../CallEngine';
import type { DeviceInfo } from '../protocol';
import { errorText } from '../signaling';
import { Icon, k, Sheet, theme } from './kit';

/**
 * Lists your other signed-in devices. Picking one sends a "Take call here?"
 * prompt to that device; the call moves only when you accept it there.
 */
export function SwitchDeviceSheet({
  visible,
  engine,
  onClose,
}: {
  visible: boolean;
  engine: CallEngine;
  onClose: () => void;
}) {
  const [devices, setDevices] = useState<DeviceInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setDevices(null);
    setError(null);
    engine
      .listOtherDevices()
      .then(setDevices)
      .catch((e) => setError(errorText(e?.code ?? '')));
  }, [visible, engine]);

  const pick = async (d: DeviceInfo) => {
    setSending(d.deviceId);
    try {
      await engine.switchTo(d.deviceId);
      onClose();
    } catch (e: any) {
      setError(errorText(e?.code ?? ''));
    } finally {
      setSending(null);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Switch device">
      <Text style={[k.dim, { marginBottom: 8 }]}>
        Move this call to another device where you're signed in to Linqa. You'll confirm on that device.
      </Text>
      {error ? <Text style={{ color: theme.danger, marginBottom: 8 }}>{error}</Text> : null}
      {devices === null && !error ? <ActivityIndicator color={theme.textDim} style={{ marginVertical: 16 }} /> : null}
      {devices?.length === 0 ? (
        <Text style={[k.body, { paddingVertical: 16 }]}>
          No other devices are online. Open Linqa on your desktop or other phone and try again.
        </Text>
      ) : null}
      {devices?.map((d) => (
        <Pressable
          key={d.deviceId}
          style={k.listRow}
          onPress={() => pick(d)}
          disabled={!!sending}
          accessibilityRole="button"
          accessibilityLabel={`Move call to ${d.name}`}
        >
          <Icon name={d.platform === 'desktop' || d.platform === 'web' ? 'monitor' : 'smartphone'} />
          <View style={{ flex: 1 }}>
            <Text style={k.body}>{d.name}</Text>
            <Text style={k.dim}>{platformText(d.platform)}</Text>
          </View>
          {sending === d.deviceId ? <ActivityIndicator color={theme.textDim} /> : <Icon name="chevron-right" color={theme.textDim} />}
        </Pressable>
      ))}
    </Sheet>
  );
}

const platformText = (p: DeviceInfo['platform']) =>
  ({ ios: 'iPhone or iPad', android: 'Android', desktop: 'Desktop app', web: 'Web', unknown: 'Device' })[p];
