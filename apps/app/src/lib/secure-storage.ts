import * as SecureStore from "expo-secure-store";

// Everything the app persists goes through the iOS Keychain. Items are only
// readable while the device is unlocked and never leave this device (no
// iCloud Keychain sync, no backups).
const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const storageKeys = {
  appLock: "zenguy.appLock",
  lastWorkspace: "zenguy.lastWorkspace",
  pushDevice: "zenguy.pushDevice",
  refreshToken: "zenguy.refreshToken",
} as const;

export type StorageKey = (typeof storageKeys)[keyof typeof storageKeys];

export const secureStorage = {
  async deleteItem(key: StorageKey): Promise<void> {
    await SecureStore.deleteItemAsync(key, options);
  },
  async getItem(key: StorageKey): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(key, options);
    } catch {
      // A corrupted or inaccessible Keychain item must never crash startup;
      // the caller treats "missing" as "signed out".
      return null;
    }
  },
  async setItem(key: StorageKey, value: string): Promise<void> {
    await SecureStore.setItemAsync(key, value, options);
  },
};
