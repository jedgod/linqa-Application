const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
const existing = config.resolver.blockList;
// Native build output is never a JS source. Avoid crawling CMake and Gradle
// caches during USB development, especially inside a Windows OneDrive path.
config.resolver.blockList = [
  ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
  /[\\/](android|ios)[\\/](?:[^\\/]+[\\/])*(build|\.cxx)[\\/]/,
  /[\\/]\.cxx[\\/]/,
  /[\\/]\.runtime[\\/]/,
];
module.exports = config;
