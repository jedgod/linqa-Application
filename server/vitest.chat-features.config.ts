import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';
const mock=fileURLToPath(new URL('./feature-tests/feature-native-mocks.ts',import.meta.url));
const system=fileURLToPath(new URL('./feature-tests/system-native-mocks.ts',import.meta.url));
export default defineConfig({resolve:{alias:{'expo-file-system/legacy':mock,'expo-media-library/legacy':mock,'expo-sharing':mock,'expo-crypto':mock,'expo-calendar':system,'expo-notifications':system,'react-native':system,'expo-document-picker':system,'expo-image-picker':system}},test:{include:['feature-tests/*.test.ts']}});


