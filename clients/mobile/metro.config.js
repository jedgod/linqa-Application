const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
config.watchFolders = [...(config.watchFolders || []), require('path').resolve(__dirname, '../shared')];
const existing = config.resolver.blockList;
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nativeRoot = name => new RegExp('^' + escapeRegex(require('path').join(__dirname, name)) + '(?:[\\\\/]|$)');
// Exclude native directories themselves, not only files below build/. On
// Windows, Gradle directory events otherwise overwhelm Metro's fallback watcher.
config.resolver.blockList = [
  ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
  nativeRoot('android'),
  nativeRoot('ios'),
  /^(android|ios)(?:[\\/]|$)/,
  /(^|[\\/])node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+[\\/](android|ios)(?:[\\/]|$)/,
  /(^|[\\/])modules[\\/][^\\/]+[\\/](android|ios)(?:[\\/]|$)/,
  /(^|[\\/])(\.cxx|\.gradle|\.runtime)(?:[\\/]|$)/,
];
module.exports = config;
