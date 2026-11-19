// الطلب المحفوظ بالجهاز (SPEC-driver §2.3–§2.4): SecureStore فقط، هذا الجهاز فقط.
import * as SecureStore from 'expo-secure-store';
import {
  clearRegistration,
  loadRegistration,
  readSecret,
  saveRegistration,
  saveSecret,
} from '../lib/secureStore';
import { secureStoreMemory } from '../test-utils/secureStoreMock';

const SECRET = 'a'.repeat(43);

it('a request needs both the request id and the device secret', async () => {
  expect(await loadRegistration()).toBeNull();
  await saveSecret(SECRET);
  expect(await loadRegistration()).toBeNull(); // أُرسل؟ بعده ما رجع request_id
  await saveRegistration({ requestId: 'r1', fullName: 'علي حسين', phone: '+9647801112222' });
  expect(await loadRegistration()).toEqual({
    requestId: 'r1',
    secret: SECRET,
    fullName: 'علي حسين',
    phone: '+9647801112222',
  });
});

it('stores with this-device-only Keychain access (no iCloud/backup migration)', async () => {
  await saveSecret(SECRET);
  expect(jest.mocked(SecureStore.setItemAsync)).toHaveBeenCalledWith(
    expect.stringMatching(/secret/),
    SECRET,
    { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
  );
  expect(await readSecret()).toBe(SECRET);
});

it('clearRegistration wipes every key (secret included)', async () => {
  await saveSecret(SECRET);
  await saveRegistration({ requestId: 'r1', fullName: 'علي', phone: '+9647801112222' });
  await clearRegistration();
  expect(secureStoreMemory.size).toBe(0);
  expect(await readSecret()).toBeNull();
});
