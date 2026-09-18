import assert from 'node:assert/strict';
import { test } from 'node:test';
// The plugin ships plain JavaScript, and this half of it needs none of the
// board client, so the test imports the module exactly as index.js does.
import { parsePosting } from '../myna-plugin/posting.js';

test('front matter in a CRLF file is not re-sliced into the body', () => {
  const parsed = parsePosting(
    '---\r\ntitle: Platform Engineer\r\norg: acme\r\n---\r\n# Platform at Acme\r\nWe are hiring.',
    undefined,
    {},
  );
  assert.equal(parsed.title, 'Platform Engineer');
  assert.equal(parsed.org, 'acme');
  assert.equal(parsed.description, '# Platform at Acme\nWe are hiring.');
});

test('a byte-order mark does not hide the front matter', () => {
  const parsed = parsePosting(
    '\uFEFF---\ntitle: Engineer\norg: acme\n---\nRole details',
    undefined,
    {},
  );
  assert.equal(parsed.title, 'Engineer');
  assert.equal(parsed.org, 'acme');
  assert.equal(parsed.description, 'Role details');
});

test('a front-matter title keeps the body h1', () => {
  const parsed = parsePosting(
    '---\norg: acme\ntitle: Front Title\n---\n# Body Heading\nText',
    undefined,
    {},
  );
  assert.equal(parsed.title, 'Front Title');
  assert.equal(parsed.description, '# Body Heading\nText');
});

test('a --title flag keeps the body h1', () => {
  const parsed = parsePosting('# Inside Heading\nBody.', 'Flag Title', {});
  assert.equal(parsed.title, 'Flag Title');
  assert.equal(parsed.description, '# Inside Heading\nBody.');
});

test('the h1 is still dropped when it became the title', () => {
  const parsed = parsePosting('# Senior Engineer\n\nApply inside.', undefined, {});
  assert.equal(parsed.title, 'Senior Engineer');
  assert.equal(parsed.description, 'Apply inside.');
});
