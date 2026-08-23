const { withInfoPlist } = require("expo/config-plugins");

/**
 * Expo Prebuild registers the iOS bundle identifier as a custom URL scheme
 * when no explicit scheme is configured. A different app can claim that
 * scheme, so Zenguy deliberately removes every CFBundleURLTypes entry and
 * accepts inbound navigation only through its verified HTTPS Universal Links.
 */
module.exports = function withUniversalLinksOnly(config) {
  return withInfoPlist(config, (next) => {
    delete next.modResults.CFBundleURLTypes;
    return next;
  });
};
