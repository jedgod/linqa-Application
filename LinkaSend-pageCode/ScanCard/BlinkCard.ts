import { NativeModules } from 'react-native';

const { BlinkCardModule } = NativeModules;

interface CardScanResult {
  cardNumber: string;
  cardHolderName: string;
  expiryDate: string;
}

export const startBlinkCardScan = (): Promise<CardScanResult> => {
  return BlinkCardModule.startScan();
};