// Node's test runner cannot load react-native (Flow source) or expo-secure-store (native bridge). Several mobile services
// import them only for platform branching and key storage; the tests that preload this file exercise pure logic.
// Preload with: node --require ./tests/support/react-native-stub.cjs --import <tsx loader> --test ...
globalThis.__DEV__ = false;
const Module = require("node:module");

const reactNative = {
  Platform: { OS: "android", Version: 34, select: (spec) => spec.android ?? spec.native ?? spec.default },
  NativeModules: {},
  AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) },
};

const secureStoreItems = new Map();
const secureStore = {
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "WHEN_UNLOCKED_THIS_DEVICE_ONLY",
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: "AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY",
  isAvailableAsync: async () => true,
  getItemAsync: async (key) => secureStoreItems.get(key) ?? null,
  setItemAsync: async (key, value) => { secureStoreItems.set(key, value); },
  deleteItemAsync: async (key) => { secureStoreItems.delete(key); },
};

const stubs = { "react-native": reactNative, "expo-secure-store": secureStore };
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  return Object.hasOwn(stubs, request) ? stubs[request] : originalLoad.call(this, request, ...rest);
};
