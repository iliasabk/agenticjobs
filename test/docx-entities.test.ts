import assert from 'node:assert/strict';
import { test } from 'node:test';
import { docxToMarkdown } from '../dist/core/import.js';

// Minimal stored ZIP with a central directory, sufficient for the DOCX reader.
function docx(xml: string): Buffer {
  const name = Buffer.from('word/document.xml');
  const data = Buffer.from(xml);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + data.length, 16);
  return Buffer.concat([local, name, data, central, name, end]);
}

test('a numeric character reference past the last code point does not kill the import', async () => {
  // &#x110000; is one past U+10FFFF and &#99999999; is nowhere near one.
  // String.fromCodePoint throws on both, and the throw used to kill the whole
  // import. A document can carry them innocently - they become U+FFFD, the
  // same replacement HTML uses.
  const result = await docxToMarkdown(
    docx(
      '<w:document><w:body><w:p><w:r><w:t>Hex &#x110000; and dec &#99999999; stay</w:t></w:r></w:p></w:body></w:document>',
    ),
  );
  assert.equal(result.markdown, 'Hex \uFFFD and dec \uFFFD stay');
});

test('in-range numeric references still decode', async () => {
  const result = await docxToMarkdown(
    docx(
      '<w:document><w:body><w:p><w:r><w:t>Ren&#233;e &#x2764; &#65;</w:t></w:r></w:p></w:body></w:document>',
    ),
  );
  assert.equal(result.markdown, 'Renée ❤ A');
});
