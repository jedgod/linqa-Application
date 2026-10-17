// CameraScanOCR.tsx
import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View, ActivityIndicator } from 'react-native';
// You need to install a React Native ML Kit OCR library, e.g. react-native-mlkit-ocr
import MlkitOcr from 'react-native-mlkit-ocr';

interface OCRResult {
  cardNumber?: string;
  cardHolderName?: string;
  expiryDate?: string;
}

interface CameraScanOCRProps {
  imageUri: string;
  onResult: (result: OCRResult) => void;
}

const CameraScanOCR: React.FC<CameraScanOCRProps> = ({ imageUri, onResult }) => {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const processImage = async () => {
      try {
        const recognizedText = await MlkitOcr.detectFromFile(imageUri);
        // recognizedText is an array of text blocks with text property
        const fullText = recognizedText.map(block => block.text).join(' ');

        // Simple regex parsing for card details
        const cardNumberMatch = fullText.match(/\b\d{13,19}\b/);
        const expiryMatch = fullText.match(/\b(0[1-9]|1[0-2])\/?([0-9]{2}|[0-9]{4})\b/);
        // Cardholder name: uppercase words longer than 3 letters (simplified)
        const nameMatch = fullText.match(/\b[A-Z ]{5,}\b/);

        const result: OCRResult = {
          cardNumber: cardNumberMatch ? cardNumberMatch[0] : undefined,
          expiryDate: expiryMatch ? expiryMatch[0] : undefined,
          cardHolderName: nameMatch ? nameMatch[0].trim() : undefined,
        };

        onResult(result);
      } catch (error) {
        console.error('OCR failed:', error);
        onResult({});
      } finally {
        setLoading(false);
      }
    };

    processImage();
  }, [imageUri]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#000" />
        <Text>Processing image...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Image source={{ uri: imageUri }} style={styles.image} resizeMode="contain" />
      <Text>OCR processing complete</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', padding: 10 },
  image: { width: '100%', height: 200, marginBottom: 10 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});

export default CameraScanOCR;
