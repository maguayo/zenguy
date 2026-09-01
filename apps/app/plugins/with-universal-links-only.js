const { withInfoPlist } = require("expo/config-plugins");

/**
 * Expo Router needs a logical scheme in the embedded Expo manifest to resolve
 * its root URL in standalone releases. Expo Prebuild also registers that value
 * as an iOS custom URL scheme. A different app can claim it, so Zenguy removes
 * every CFBundleURLTypes entry while retaining the logical manifest value.
 * Inbound navigation is accepted only through verified HTTPS Universal Links.
 */
module.exports = function withUniversalLinksOnly(config) {
  return withInfoPlist(config, (next) => {
    delete next.modResults.CFBundleURLTypes;
    return next;
  });
};
