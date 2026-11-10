// Metro bundler config for CourseVault mobile.
// megajs is imported by direct path (megajs/dist/main.browser-es.mjs),
// so Metro needs to resolve .mjs files.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.sourceExts = [...(config.resolver.sourceExts || []), 'mjs'];

module.exports = config;
