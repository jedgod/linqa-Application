// CardDetailsForm.tsx
import React, { useState, useEffect } from 'react';
import { Alert, Button, StyleSheet, Text, TextInput, View, ScrollView } from 'react-native';

interface CardDetails {
  cardNumber: string;
  cardHolderName: string;
  expiryDate: string;
  cvv: string;
}

interface CardDetailsFormProps {
  initialDetails?: Partial<CardDetails>;
  onSubmit: (details: CardDetails) => void;
}

const CardDetailsForm: React.FC<CardDetailsFormProps> = ({ initialDetails = {}, onSubmit }) => {
  const [cardNumber, setCardNumber] = useState(initialDetails.cardNumber || '');
  const [cardHolderName, setCardHolderName] = useState(initialDetails.cardHolderName || '');
  const [expiryDate, setExpiryDate] = useState(initialDetails.expiryDate || '');
  const [cvv, setCvv] = useState('');

  useEffect(() => {
    if (initialDetails.cardNumber) setCardNumber(initialDetails.cardNumber);
    if (initialDetails.cardHolderName) setCardHolderName(initialDetails.cardHolderName);
    if (initialDetails.expiryDate) setExpiryDate(initialDetails.expiryDate);
  }, [initialDetails]);

  const validate = (): boolean => {
    if (!/^\d{13,19}$/.test(cardNumber.replace(/\s+/g, ''))) {
      Alert.alert('Invalid card number');
      return false;
    }
    if (cardHolderName.length < 3) {
      Alert.alert('Invalid cardholder name');
      return false;
    }
    if (!/^(0[1-9]|1[0-2])\/?([0-9]{2})$/.test(expiryDate)) {
      Alert.alert('Invalid expiry date. Use MM/YY format');
      return false;
    }
    if (!/^\d{3,4}$/.test(cvv)) {
      Alert.alert('Invalid CVV');
      return false;
    }
    return true;
  };

  const handleSubmit = () => {
    if (validate()) {
      onSubmit({ cardNumber, cardHolderName, expiryDate, cvv });
    }
  };

  return ( 
  <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.label}>Card Number</Text>
      <TextInput
        style={styles.input}
        keyboardType="number-pad"
        value={cardNumber}
        onChangeText={setCardNumber}
        placeholder="1234 5678 9012 3456"
        maxLength={19}
      />

      <Text style={styles.label}>Cardholder Name</Text>
      <TextInput
        style={styles.input}
        value={cardHolderName}
        onChangeText={setCardHolderName}
        placeholder="JOHN DOE"
        autoCapitalize="characters"
      />

      <Text style={styles.label}>Expiry Date (MM/YY)</Text>
      <TextInput
        style={styles.input}
        value={expiryDate}
        onChangeText={setExpiryDate}
        placeholder="MM/YY"
        maxLength={5}
      />

      <Text style={styles.label}>CVV</Text>
      <TextInput
        style={styles.input}
        keyboardType="number-pad"
        value={cvv}
        onChangeText={setCvv}
        placeholder="123"
        maxLength={4}
        secureTextEntry
      />

      <Button title="Proceed" onPress={handleSubmit} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { padding: 20 },
  label: { fontWeight: 'bold', marginTop: 15 },
  input: {
    borderWidth: 1,
    borderColor: '#999',
    borderRadius: 5,
    padding: 10,
    marginTop: 5,
  },
});

export default CardDetailsForm;

import BraintreeDropIn from 'react-native-braintree-payments-drop-in';

const tokenizeCard = async () => {
  try {
    const result = await BraintreeDropIn.show({
      clientToken: 'YOUR_BRAINTREE_CLIENT_TOKEN', // Obtain from your backend securely
      cardDisabled: false,
      vaultManager: false,
      googlePay: false,
      applePay: false,
      paypal: false,
    });

    if (result) {
      // result.nonce is the payment method nonce (token)
      console.log('Payment nonce:', result.nonce);
      // Send nonce to your backend to create transaction
    }
  } catch (error) {
    console.error('Braintree tokenization error:', error);
  }
};

