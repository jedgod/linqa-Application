import React, { useState } from 'react';
import { Button, SafeAreaView, StyleSheet, Text, View, Alert } from 'react-native';
import { startBlinkCardScan } from '../../BlinkCard';

const BlinkCardScreen = () => {
  const [cardData, setCardData] = useState<{ cardNumber: string; cardHolderName: string; expiryDate: string } | null>(null);

  const handleScan = async () => {
    try {
      const result = await startBlinkCardScan();
      setCardData(result);
      Alert.alert('Scan Successful', JSON.stringify(result, null, 2));
    } catch (error) {
      Alert.alert('Scan Failed', error.message || 'Unknown error');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Button title="Scan Card" onPress={handleScan} />
      {cardData && (
        <View style={styles.result}>
          <Text>Card Number: {cardData.cardNumber}</Text>
          <Text>Cardholder Name: {cardData.cardHolderName}</Text>
          <Text>Expiry Date: {cardData.expiryDate}</Text>
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 20 },
  result: { marginTop: 20 },
});

export default BlinkCardScreen;