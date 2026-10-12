/**
 * Expo config plugin for Linqa calls (iOS side; Android is handled by the
 * manifest inside modules/linqa-call-native, merged automatically).
 *
 * app.config.ts:
 *   plugins: [
 *     ['./plugins/withLinqaCalls', { appleTeamId: 'ABCDE12345' }],
 *   ]
 *
 * Adds:
 *  - camera / microphone usage text, background modes (audio, voip, remote-notification)
 *  - App Group shared by the app and the screen-share extension
 *  - the LinqaScreenShare Broadcast Upload Extension target
 *  - Info.plist keys react-native-webrtc reads to find the extension
 *  - EAS credentials hint so EAS Build signs the extension too
 */
const fs = require('fs');
const path = require('path');
const {
  createRunOncePlugin,
  withDangerousMod,
  withEntitlementsPlist,
  withInfoPlist,
  withXcodeProject,
} = require('expo/config-plugins');

const EXT = 'LinqaScreenShare';
const EXT_SRC = path.join(__dirname, '..', 'ios-extension', EXT);
const EXT_FILES = ['SampleHandler.swift'];
const DEPLOYMENT_TARGET = '15.1';

function ids(config, props) {
  const bundleId = config.ios && config.ios.bundleIdentifier;
  if (!bundleId) throw new Error('[withLinqaCalls] Set ios.bundleIdentifier in your app config.');
  return {
    bundleId,
    extBundleId: `${bundleId}.${EXT}`,
    appGroup: props.appGroup || `group.${bundleId}`,
  };
}

/** The xcode library stores names quoted ("Name"), so pbxTargetByName can miss them. */
function hasTarget(proj, name) {
  const targets = proj.pbxNativeTargetSection();
  return Object.keys(targets).some((k) => {
    const t = targets[k];
    return typeof t === 'object' && String(t.name).replace(/^"|"$/g, '') === name;
  });
}

function addUnique(list, values) {
  const out = Array.isArray(list) ? [...list] : [];
  for (const v of values) if (!out.includes(v)) out.push(v);
  return out;
}

const withCallsInfoPlist = (config, props) =>
  withInfoPlist(config, (c) => {
    const { extBundleId, appGroup } = ids(c, props);
    const p = c.modResults;
    p.NSCameraUsageDescription =
      p.NSCameraUsageDescription || 'Linqa uses the camera for video calls.';
    p.NSMicrophoneUsageDescription =
      p.NSMicrophoneUsageDescription || 'Linqa uses the microphone for calls.';
    p.UIBackgroundModes = addUnique(p.UIBackgroundModes, ['audio', 'voip', 'remote-notification']);
    p.RTCAppGroupIdentifier = appGroup;
    p.RTCScreenSharingExtension = extBundleId;
    return c;
  });

const withCallsEntitlements = (config, props) =>
  withEntitlementsPlist(config, (c) => {
    const { appGroup } = ids(c, props);
    const e = c.modResults;
    e['com.apple.security.application-groups'] = addUnique(e['com.apple.security.application-groups'], [appGroup]);
    // PushKit needs the push entitlement. EAS switches this to production for store builds.
    e['aps-environment'] = e['aps-environment'] || 'development';
    return c;
  });

/** Copies the extension sources into ios/ and writes its entitlements. */
const withExtensionFiles = (config, props) =>
  withDangerousMod(config, [
    'ios',
    async (c) => {
      const { appGroup } = ids(c, props);
      const dest = path.join(c.modRequest.platformProjectRoot, EXT);
      fs.mkdirSync(dest, { recursive: true });
      for (const f of EXT_FILES) fs.copyFileSync(path.join(EXT_SRC, f), path.join(dest, f));
      const plist = fs.readFileSync(path.join(EXT_SRC, 'Info.plist'), 'utf8').replace('__APP_GROUP__', appGroup);
      fs.writeFileSync(path.join(dest, 'Info.plist'), plist);
      fs.writeFileSync(
        path.join(dest, `${EXT}.entitlements`),
        `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.application-groups</key>
  <array>
    <string>${appGroup}</string>
  </array>
</dict>
</plist>
`,
      );
      return c;
    },
  ]);

const withExtensionTarget = (config, props) =>
  withXcodeProject(config, (c) => {
    const proj = c.modResults;
    const { extBundleId } = ids(c, props);
    if (hasTarget(proj, EXT)) return c; // already added on a previous prebuild

    // The xcode library assumes these sections exist; a fresh Expo project may not have them.
    const objects = proj.hash.project.objects;
    objects.PBXTargetDependency = objects.PBXTargetDependency || {};
    objects.PBXContainerItemProxy = objects.PBXContainerItemProxy || {};

    const group = proj.addPbxGroup([...EXT_FILES, 'Info.plist', `${EXT}.entitlements`], EXT, EXT);
    const mainGroup = proj.getFirstProject().firstProject.mainGroup;
    proj.addToPbxGroup(group.uuid, mainGroup);

    // 'app_extension' also adds an "Embed App Extensions" copy phase to the app target.
    const target = proj.addTarget(EXT, 'app_extension', EXT, extBundleId);
    proj.addBuildPhase(EXT_FILES, 'PBXSourcesBuildPhase', 'Sources', target.uuid);
    proj.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', target.uuid);
    proj.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid); // ReplayKit auto-links from `import ReplayKit`

    const version = c.version || '1.0.0';
    const build = (c.ios && c.ios.buildNumber) || '1';
    const configs = proj.pbxXCBuildConfigurationSection();
    for (const key of Object.keys(configs)) {
      const bs = configs[key].buildSettings;
      if (!bs || (bs.PRODUCT_NAME !== `"${EXT}"` && bs.PRODUCT_NAME !== EXT)) continue;
      Object.assign(bs, {
        PRODUCT_BUNDLE_IDENTIFIER: `"${extBundleId}"`,
        INFOPLIST_FILE: `"${EXT}/Info.plist"`,
        CODE_SIGN_ENTITLEMENTS: `"${EXT}/${EXT}.entitlements"`,
        CODE_SIGN_STYLE: 'Automatic',
        IPHONEOS_DEPLOYMENT_TARGET: DEPLOYMENT_TARGET,
        TARGETED_DEVICE_FAMILY: '"1,2"',
        SWIFT_VERSION: '5.0',
        MARKETING_VERSION: version,
        CURRENT_PROJECT_VERSION: build,
        SKIP_INSTALL: 'YES',
        APPLICATION_EXTENSION_API_ONLY: 'YES',
        GENERATE_INFOPLIST_FILE: 'NO',
        LD_RUNPATH_SEARCH_PATHS: '"$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"',
        ...(props.appleTeamId ? { DEVELOPMENT_TEAM: props.appleTeamId } : {}),
      });
    }
    if (props.appleTeamId) proj.addTargetAttribute('DevelopmentTeam', props.appleTeamId, target);
    return c;
  });

/** Tells EAS Build to create credentials for the extension too. */
function withEasExtension(config, props) {
  const { extBundleId, appGroup } = ids(config, props);
  config.extra = config.extra || {};
  config.extra.eas = config.extra.eas || {};
  config.extra.eas.build = config.extra.eas.build || {};
  config.extra.eas.build.experimental = config.extra.eas.build.experimental || {};
  const iosExp = (config.extra.eas.build.experimental.ios = config.extra.eas.build.experimental.ios || {});
  const list = (iosExp.appExtensions = iosExp.appExtensions || []);
  if (!list.some((e) => e.targetName === EXT)) {
    list.push({
      targetName: EXT,
      bundleIdentifier: extBundleId,
      entitlements: { 'com.apple.security.application-groups': [appGroup] },
    });
  }
  return config;
}

function withLinqaCalls(config, props = {}) {
  config = withCallsInfoPlist(config, props);
  config = withCallsEntitlements(config, props);
  config = withExtensionFiles(config, props);
  config = withExtensionTarget(config, props);
  config = withEasExtension(config, props);
  return config;
}

module.exports = createRunOncePlugin(withLinqaCalls, 'linqa-calls', '1.0.0');
