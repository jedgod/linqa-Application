// Merge these into your existing app.config.ts.
import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Linqa',
  slug: 'linqa',
  version: '1.0.0',
  ios: {
    bundleIdentifier: 'app.linqa.mobile',
    buildNumber: '1',
    deploymentTarget: '15.1',
  },
  android: {
    package: 'app.linqa.mobile',
    // Firebase console > Android app > google-services.json. Needed for ringing when the app is closed.
    googleServicesFile: './google-services.json',
  },
  plugins: [
    // Camera/mic text, background modes, App Group, screen-share extension (iOS).
    ['./plugins/withLinqaCalls', { appleTeamId: 'YOUR_TEAM_ID' }],
    // Sets the iOS deployment target the native call module needs.
    ['expo-build-properties', { ios: { deploymentTarget: '15.1' } }],
  ],
};

export default config;
