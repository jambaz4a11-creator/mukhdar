import { PACKAGE_NAME } from './index';

describe('setup', () => {
  it('runs jest with TypeScript', () => {
    expect(PACKAGE_NAME).toBe('@mukhdar/shared');
  });
});
