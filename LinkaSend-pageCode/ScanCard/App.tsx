// App.tsx
import React, { useState } from 'react';
import { SafeAreaView, StyleSheet, View, Text, Alert } from 'react-native';
import CameraCapture from './CameraCapture';
import CameraScanOCR from './CameraScanOCR';
import CardDetailsForm from './CardDetailsForm';

interface OCRResult {
  cardNumber?: string;
  cardHolderName?: string;
  expiryDate?: string;
}

const App = () => {
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [ocrResult, setOcrResult] = useState<OCRResult>({});
  const [showForm, setShowForm] = useState(false);

  const handleCapture = (uri: string) => {
    setImageUri(uri);
    setShowForm(false);
  };

  const handleOCRResult = (result: OCRResult) => {
    setOcrResult(result);
    setShowForm(true);
  };

  const handleSubmit = (details: any) => {
    // Here you would integrate with payment SDK securely
    Alert.alert('Card Details Submitted', JSON.stringify(details, null, 2));
  };

  return (
    <SafeAreaView style={styles.container}>
      {!imageUri && <CameraCapture onCapture={handleCapture} />}
      {imageUri && !showForm && (
        <CameraScanOCR imageUri={imageUri} onResult={handleOCRResult} />
      )}
      {showForm && (
        <CardDetailsForm initialDetails={ocrResult} onSubmit={handleSubmit} />
      )}
      {showForm && (
        <View style={{ marginTop: 10 }}>
          <Text
            onPress={() => {
              setImageUri(null);
              setShowForm(false);
              setOcrResult({});
            }}
            style={{ color: 'blue' }}
          >
            Retake Photo
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
});

export default App;
