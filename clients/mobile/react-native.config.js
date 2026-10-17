/**
 * Keeps one unused dependency out of the native Android build.
 *
 * react-native-braintree-payments-drop-in is listed in package.json but nothing in the app imports it, and its Android
 * build script still calls jcenter(), which Gradle 9 removed, so it stops the whole app from building. LinqaSend sends card
 * details only to the payment provider's own tokenizer (services/card-tokenizer.ts), so it is not needed.
 * Remove the dependency from package.json to retire this exclusion.
 */
module.exports = {
  dependencies: {
    "react-native-braintree-payments-drop-in": { platforms: { android: null } }
  }
};
