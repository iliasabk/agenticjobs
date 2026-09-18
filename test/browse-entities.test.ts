/**
 * Entity decoding in the page importer.
 *
 * A resume page that prints a reference literally - "write &lt;em&gt;" on a
 * CV about markup, say - encodes it as &amp;lt;. Decoding the ampersand
 * before the named references decodes the same text twice and hands the
 * author back a real "<em>" where they wrote the entity name out on
 * purpose. The pass has to be single, and it has to survive a page that
 * uses hexadecimal references or an out-of-range code point.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { htmlToMarkdown } from '../dist/core/browse.js';

test('an entity written as text stays text instead of decoding twice', () => {
  const html =
    '<html><body><p>write it as &amp;lt;em&amp;gt;text&amp;lt;/em&amp;gt; to mark it up</p>' +
    '<p>a second paragraph long enough to carry the fixture over the line</p></body></html>';
  const markdown = htmlToMarkdown(html);
  assert.ok(markdown.includes('&lt;em&gt;text&lt;/em&gt;'), markdown);
  assert.ok(!markdown.includes('<em>'), markdown);
});

test('a doubly encoded ampersand decodes exactly once', () => {
  const html =
    '<html><body><p>the source says &amp;amp; for a literal one</p>' +
    '<p>a second paragraph long enough to carry the fixture over the line</p></body></html>';
  assert.ok(htmlToMarkdown(html).includes('&amp;'), htmlToMarkdown(html));
});

test('hexadecimal and decimal references both decode', () => {
  const html =
    '<html><body><p>hex &#x27; and dec &#39; and nbsp&nbsp;all land</p>' +
    '<p>a second paragraph long enough to carry the fixture over the line</p></body></html>';
  const markdown = htmlToMarkdown(html);
  assert.ok(markdown.includes("hex ' and dec ' and nbsp all land"), markdown);
});

test('an out-of-range code point becomes the replacement character instead of throwing', () => {
  const html =
    '<html><body><p>&#99999999; &#x110000; still text</p>' +
    '<p>a second paragraph long enough to carry the fixture over the line</p></body></html>';
  const markdown = htmlToMarkdown(html);
  assert.ok(markdown.includes('\ufffd'), markdown);
  assert.ok(!markdown.includes('&#99999999;'), markdown);
  assert.ok(!markdown.includes('&#x110000;'), markdown);
});
