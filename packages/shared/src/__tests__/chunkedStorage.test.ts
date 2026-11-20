import { CHUNK_SIZE, createChunkedStorage, type KeyValueStore } from '../chunkedStorage';

function memoryStore() {
  const map = new Map<string, string>();
  const store: KeyValueStore = {
    getItemAsync: (k) => Promise.resolve(map.get(k) ?? null),
    setItemAsync: (k, v) => {
      // نفس قيود expo-secure-store
      if (!/^[A-Za-z0-9._-]+$/.test(k)) return Promise.reject(new Error(`invalid key ${k}`));
      if (v.length > 2048) return Promise.reject(new Error('value too large'));
      map.set(k, v);
      return Promise.resolve();
    },
    deleteItemAsync: (k) => {
      map.delete(k);
      return Promise.resolve();
    },
  };
  return { map, store };
}

describe('createChunkedStorage', () => {
  it('round-trips a value larger than one SecureStore entry', async () => {
    const { map, store } = memoryStore();
    const s = createChunkedStorage(store);
    const big = 'x'.repeat(CHUNK_SIZE * 2 + 5);
    await s.setItem('sb-ref-auth-token', big);
    expect(map.get('sb-ref-auth-token.n')).toBe('3');
    expect(await s.getItem('sb-ref-auth-token')).toBe(big);
  });

  it('shrinking removes stale chunks; removeItem clears everything', async () => {
    const { map, store } = memoryStore();
    const s = createChunkedStorage(store);
    await s.setItem('k', 'y'.repeat(CHUNK_SIZE * 3));
    await s.setItem('k', 'short');
    expect([...map.keys()].sort()).toEqual(['k.0', 'k.n']);
    await s.removeItem('k');
    expect(map.size).toBe(0);
    expect(await s.getItem('k')).toBeNull();
  });

  it('sanitizes keys and treats a partial write as missing', async () => {
    const { map, store } = memoryStore();
    const s = createChunkedStorage(store);
    await s.setItem('a b:c', 'v');
    expect(map.has('a_b_c.0')).toBe(true);
    map.set('broken.n', '2');
    map.set('broken.0', 'half');
    expect(await s.getItem('broken')).toBeNull();
  });
});
