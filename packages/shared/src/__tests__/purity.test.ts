import fs from 'node:fs';
import path from 'node:path';
import { PACKAGE_NAME } from '../index';

const pkgDir = path.resolve(__dirname, '../..');
const FORBIDDEN = /^(react|react-native|react-dom|next|expo)(\/|$)|^@react-native|^@expo\/|^expo-/;

describe('package boundaries (T06 acceptance)', () => {
  it('exports the package', () => {
    expect(PACKAGE_NAME).toBe('@mukhdar/shared');
  });

  it('has no React Native, Expo, React or Next dependency', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')) as Record<
      string,
      Record<string, string> | undefined
    >;
    const deps = ['dependencies', 'devDependencies', 'peerDependencies'].flatMap((k) =>
      Object.keys(pkg[k] ?? {}),
    );
    expect(deps.filter((d) => FORBIDDEN.test(d))).toEqual([]);
  });

  it('no source file imports React Native, Expo, React or Next', () => {
    const files = fs.readdirSync(path.join(pkgDir, 'src')).filter((f) => f.endsWith('.ts'));
    const imports = files.flatMap((f) =>
      [...fs.readFileSync(path.join(pkgDir, 'src', f), 'utf8').matchAll(/from '([^']+)'/g)].map(
        (m) => m[1] as string,
      ),
    );
    expect(files.length).toBeGreaterThan(5);
    expect(imports.filter((i) => FORBIDDEN.test(i))).toEqual([]);
  });
});
