// BlinkCardScanner.tsx
import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ActivityIndicator, Dimensions } from 'react-native';
import { NativeModules, NativeEventEmitter } from 'react-native';

const { BlinkCardModule } = NativeModules; // Native bridge module

const BlinkCardScanner = ({ onScanSuccess, onScanError }: { onScanSuccess: (data: any) => void; onScanError: (error: any) => void }) => {
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const eventEmitter = new NativeEventEmitter(BlinkCardModule);
    const subscription = eventEmitter.addListener('BlinkCardScanResult', (event) => {
      setLoading(false);
      setScanning(false);
      if (event.success) {
        onScanSuccess(event.data);
      } else {
        onScanError(event.error);
      }
    });

    return () => subscription.remove();
  }, []);

  const startScan = () => {
    setScanning(true);
    setLoading(true);
    BlinkCardModule.startScan();
  };

  return (
    <View style={styles.container}>
      {loading && <ActivityIndicator size="large" color="#007AFF" />}
      {!scanning && (
        <TouchableOpacity style={styles.button} onPress={startScan}>
          <Text style={styles.buttonText}>Start Card Scan</Text>
        </TouchableOpacity>
      )}
      {/* Overlay for user guidance */}
      {scanning && (
        <View style={styles.overlay}>
          <View style={styles.cardFrame} />
          <Text style={styles.instruction}>Align your card inside the frame</Text>
        </View>
      )}
    </View>
  );
};

const { width } = Dimensions.get('window');
const frameWidth = width * 0.9;
const frameHeight = frameWidth * 0.63; // Typical card aspect ratio

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  button: { backgroundColor: '#007AFF', padding: 15, borderRadius: 8 },
  buttonText: { color: '#fff', fontSize: 18 },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' },
  cardFrame: {
    width: frameWidth,
    height: frameHeight,
    borderColor: '#00FF00',
    borderWidth: 3,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  instruction: { color: '#fff', marginTop: 20, fontSize: 16 },
});

export default BlinkCardScanner;
