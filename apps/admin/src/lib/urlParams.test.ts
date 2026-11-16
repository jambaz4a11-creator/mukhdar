import { describe, expect, it } from 'vitest';
import { applyUrlPatch, patchSearch, type UrlLocation } from './urlParams';

function fakeLocation(path: string, search = ''): UrlLocation & { url: () => string } {
  const state = { pathname: path, search };
  return {
    get pathname() {
      return state.pathname;
    },
    get search() {
      return state.search;
    },
    replace(url) {
      const i = url.indexOf('?');
      state.search = i === -1 ? '' : url.slice(i);
    },
    url: () => state.pathname + state.search,
  };
}

describe('patchSearch', () => {
  it('sets, replaces and deletes keys', () => {
    expect(patchSearch('?a=1&b=2', { a: null, c: '3' })).toBe('b=2&c=3');
    expect(patchSearch('', { q: '' })).toBe('');
  });
  it('drops values equal to the default', () => {
    expect(patchSearch('?f=5', { f: 'all' }, { f: 'all' })).toBe('');
  });
});

describe('applyUrlPatch: rapid changes never revert each other', () => {
  it('two patches before any re-render both survive (driver then day)', () => {
    const loc = fakeLocation('/orders', '?tab=active');
    applyUrlPatch({ driver: 'd1', order: null }, loc);
    applyUrlPatch({ day: '2026-11-10', order: null }, loc);
    const sp = new URLSearchParams(loc.search);
    expect(sp.get('tab')).toBe('active');
    expect(sp.get('driver')).toBe('d1');
    expect(sp.get('day')).toBe('2026-11-10');
  });

  it('a late search-debounce patch keeps what was chosen meanwhile', () => {
    const loc = fakeLocation('/orders');
    applyUrlPatch({ driver: 'd1' }, loc); // نقرة السائق
    applyUrlPatch({ q: '0770', order: null }, loc); // مؤقت البحث يطلق متأخراً
    expect(new URLSearchParams(loc.search).get('driver')).toBe('d1');
    expect(new URLSearchParams(loc.search).get('q')).toBe('0770');
  });

  it('ratings: from then to in quick succession; preset all is dropped', () => {
    const loc = fakeLocation('/ratings', '?f=5');
    applyUrlPatch({ from: '2026-11-01' }, loc, { f: 'all' });
    applyUrlPatch({ to: '2026-11-10', f: 'all' }, loc, { f: 'all' });
    expect(loc.url()).toBe('/ratings?from=2026-11-01&to=2026-11-10');
  });
});
