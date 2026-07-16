import * as SecureStore from 'expo-secure-store';

// SecureStore (iOS Keychain / Android Keystore) sarmalayıcı — spec §7 saklama kararı.
// Arayüz enjekte edilebilir: testler bellek-içi fake kullanır (RN import'u test
// dosyalarına sızmaz).

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
}

export const secureStorage: KeyValueStore = {
  get: (k) => SecureStore.getItemAsync(k),
  set: (k, v) => SecureStore.setItemAsync(k, v),
  del: (k) => SecureStore.deleteItemAsync(k),
};
