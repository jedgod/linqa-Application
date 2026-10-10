const { withAndroidManifest, withMainApplication, AndroidConfig } = require('expo/config-plugins');
module.exports = function withChatFeatures(config) {
  config = AndroidConfig.Permissions.withPermissions(config, [
    'android.permission.ACCESS_COARSE_LOCATION', 'android.permission.ACCESS_FINE_LOCATION',
    'android.permission.READ_CONTACTS', 'android.permission.WRITE_CONTACTS',
    'android.permission.READ_CALENDAR', 'android.permission.WRITE_CALENDAR',
    'android.permission.POST_NOTIFICATIONS', 'android.permission.FOREGROUND_SERVICE',
    'android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION'
  ]);
  config = withAndroidManifest(config, cfg => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app.service ??= [];
    if (!app.service.some(s => s.$['android:name'] === 'com.oney.WebRTCModule.MediaProjectionService')) {
      app.service.push({ $: { 'android:name': 'com.oney.WebRTCModule.MediaProjectionService', 'android:exported': 'false', 'android:foregroundServiceType': 'mediaProjection' } });
    }
    return cfg;
  });
  return withMainApplication(config, cfg => {
    if (!cfg.modResults.contents.includes('enableMediaProjectionService = true')) {
      cfg.modResults.contents = cfg.modResults.contents.replace('super.onCreate()', 'super.onCreate()\n    com.oney.WebRTCModule.WebRTCModuleOptions.getInstance().enableMediaProjectionService = true');
    }
    return cfg;
  });
};
