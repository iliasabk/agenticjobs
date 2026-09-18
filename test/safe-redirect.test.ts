import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safeRedirect } from '../dist/core/auth.js';

test('same-origin paths are kept, off-site redirects dropped', () => {
  assert.equal(safeRedirect('/me'), '/me');
  assert.equal(safeRedirect('/device?code=WXYZ-1234'), '/device?code=WXYZ-1234');
  assert.equal(safeRedirect(''), null);
  assert.equal(safeRedirect('https://evil.example/steal'), null);
  assert.equal(safeRedirect('//evil.example/steal'), null);
  assert.equal(safeRedirect('javascript:alert(1)'), null);
});

test('a leading backslash is a slash to a browser, so /\\host is //host', () => {
  // new URL('/\\evil.example', 'https://board.example') resolves off-origin
  // to https://evil.example/ — the open redirect this gate exists to stop.
  for (const redirect of [
    '/\\evil.example',
    '/\\/evil.example',
    '/\\evil.example@x.example',
  ]) {
    assert.notEqual(
      new URL(redirect, 'https://board.example').origin,
      'https://board.example',
      `${redirect} no longer resolves off-origin; the test needs a new vector`,
    );
    assert.equal(safeRedirect(redirect), null, redirect);
  }
});

test('a backslash anywhere is refused, not only the leading kind', () => {
  // A path that happens to resolve on-origin today is one WHATWG parsing
  // tweak away from not doing so; there is no legitimate backslash in a path.
  for (const redirect of ['/path\\..\\evil.example', '/path\\evil.example']) {
    assert.equal(safeRedirect(redirect), null, redirect);
  }
});
