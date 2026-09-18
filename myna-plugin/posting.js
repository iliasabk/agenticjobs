/**
 * Front matter for the structured fields, Markdown below for the body.
 *
 * This is the same vocabulary the CLI's jobfile parser accepts (`key: value`
 * lines under a `---` fence), so a posting file reads the same way through
 * `myna post` as through `agenticjobs post`. It lives in its own module
 * because index.js imports the board client, and this half of the job needs
 * none of that.
 */

export function parsePosting(text, title, extra) {
  const fields = { ...extra };
  // UTF-8 readers retain a leading byte-order mark, and a file written on
  // Windows arrives with CRLF endings. Both are normalised before the front
  // matter is measured: the slice below is taken from the same string the
  // match was measured on, or it cuts mid-line.
  const source = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(source);
  let body = source;

  if (match) {
    body = source.slice(match[0].length);
    for (const line of match[1].split('\n')) {
      const pair = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.+)$/.exec(line);
      if (!pair) continue;
      const key = pair[1].replace(/[_-]([a-z])/g, (_, c) => c.toUpperCase());
      fields[key] = pair[2].trim().replace(/^["']|["']$/g, '');
    }
  }

  const heading = /^#\s+(.+)$/m.exec(body);
  const supplied = fields.title ?? title;
  fields.title = supplied ?? heading?.[1]?.trim();
  // The h1 is dropped when it became the title, so the listing does not show
  // the same line twice. A title from the front matter or the flag keeps the
  // body exactly as written, h1 and all.
  fields.description =
    heading && supplied == null ? body.replace(/^#\s+.+\n?/m, '').trim() : body.trim();
  return fields;
}
