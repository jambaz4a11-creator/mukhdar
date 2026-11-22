// R3 M4 (SPEC-webpush §6.3): شريط تنبيه عند عمل التخزين المشفَّر بالذاكرة فقط (وضع خاص)، ولا شيء غير ذلك.
import { screen } from '@testing-library/react-native';
import { ar } from '../i18n/ar';
import { renderScreen } from '../test-utils/render';

const mockReady = jest.fn<Promise<{ degraded: boolean }>, []>();
jest.mock('../lib/secureStorage.web', () => ({ secureStorage: { ready: () => mockReady() } }));

import { StorageWarning } from '../components/StorageWarning.web';
import { StorageWarning as NativeStorageWarning } from '../components/StorageWarning';

describe('StorageWarning (web)', () => {
  it('memory-only storage: shows the Arabic warning', async () => {
    mockReady.mockResolvedValue({ degraded: true });
    await renderScreen(<StorageWarning />);
    expect(await screen.findByTestId('storage-degraded-banner')).toBeTruthy();
    expect(screen.getByText(ar.storage.degraded)).toBeTruthy();
  });

  it('encrypted IndexedDB storage: nothing', async () => {
    mockReady.mockResolvedValue({ degraded: false });
    await renderScreen(<StorageWarning />);
    await Promise.resolve();
    expect(screen.queryByTestId('storage-degraded-banner')).toBeNull();
  });

  it('ready() failing never shows a broken banner', async () => {
    mockReady.mockRejectedValue(new Error('x'));
    await renderScreen(<StorageWarning />);
    await Promise.resolve();
    expect(screen.queryByTestId('storage-degraded-banner')).toBeNull();
  });

  it('native: always nothing', async () => {
    await renderScreen(<NativeStorageWarning />);
    expect(screen.queryByTestId('storage-degraded-banner')).toBeNull();
  });
});
