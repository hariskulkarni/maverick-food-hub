import { describe, expect, it } from 'vitest';
import { assertDisposableDbUrl } from './global-setup';

describe('test:db harness guard', () => {
  it('accepts a localhost ci* database', () => {
    expect(() => assertDisposableDbUrl('postgresql://ci@localhost:55432/ci_c?schema=public')).not.toThrow();
  });
  it('refuses a non-local host', () => {
    expect(() => assertDisposableDbUrl('postgresql://u@db.example.test:5432/ci_c')).toThrow(/not localhost/);
  });
  it('refuses a database name not starting with ci', () => {
    expect(() => assertDisposableDbUrl('postgresql://u@localhost:5432/flavrly')).toThrow(/does not start with "ci"/);
  });
  it('refuses an unset url', () => {
    expect(() => assertDisposableDbUrl(undefined)).toThrow(/not set/);
  });
});
