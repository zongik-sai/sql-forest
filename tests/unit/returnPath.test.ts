import { describe, expect, it } from 'vitest';
import { appRootUrl, cleanUrl, readCallbackParams, sanitizeReturnPath } from '../../src/features/auth/returnPath';

describe('OAuth 루트 callback 복귀 경로', () => {
  it.each([
    ['/learn/U01', '/learn/U01'],
    ['/learn/U01/U01-A02', '/learn/U01/U01-A02'],
    ['/garden', '/garden'],
  ])('허용: %s', (i, o) => expect(sanitizeReturnPath(i)).toBe(o));
  it.each(['https://evil.example/', '//evil.example', 'javascript:alert(1)', '/learn/../../x', '/a?b=c', '/a#b', 'learn/U01', '/\\evil', ''])('거부: %s', (i) => {
    expect(sanitizeReturnPath(i)).toBeNull();
  });
  it('code query를 지우고 hash 경로로 복귀, 없으면 대시보드', () => {
    expect(cleanUrl('/sql-forest/', '/learn/U03')).toBe('/sql-forest/#/learn/U03');
    expect(cleanUrl('/sql-forest/', 'https://evil.example')).toBe('/sql-forest/#/garden');
    expect(cleanUrl('/', null)).toBe('/#/garden');
  });
  it('callback 파라미터 읽기', () => {
    expect(readCallbackParams('?code=abc')).toEqual({ code: 'abc', error: null });
    expect(readCallbackParams('?error=access_denied&error_description=User+denied')).toEqual({ code: null, error: 'User denied' });
  });
  it('redirectTo는 프로젝트 루트(hash 없음)', () => {
    expect(appRootUrl('https://owner.github.io', '/sql-forest/')).toBe('https://owner.github.io/sql-forest/');
  });
});
