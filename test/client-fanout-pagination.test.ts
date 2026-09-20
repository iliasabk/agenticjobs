/**
 * Configured-board pagination.
 *
 * `searchEverywhere` merges pages from several boards, so `limit` and
 * `offset` describe a window over the merged order — not over each board's
 * own list. Applying them per board and then merging silently drops jobs
 * that sort inside the window globally but outside it locally.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { searchEverywhere } from '../dist/client/fanout.js';

interface MockBoard {
  server: string;
  items: { slug: string; createdAt?: string; publishedAt?: string }[];
  total?: number;
}

function stubFetch(t: { mock: { method: (o: object, k: string, f: unknown) => void } }, boards: MockBoard[]) {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url.toString());
    const board = boards.find((b) => url.hostname === new URL(b.server).hostname);
    if (board === undefined) return new Response('not found', { status: 404 });
    const limit = Number(url.searchParams.get('limit') ?? '25');
    const offset = Number(url.searchParams.get('offset') ?? '0');
    return Response.json({
      items: board.items.slice(offset, offset + limit),
      total: board.total ?? board.items.length,
    });
  });
  return calls;
}

test('limit and offset apply once over the merged order, not per board', async (t) => {
  stubFetch(t, [
    {
      server: 'https://a.test',
      items: [{ slug: 'a1', createdAt: '2026-01-04' }, { slug: 'a2', createdAt: '2026-01-02' }],
    },
    {
      server: 'https://b.test',
      items: [{ slug: 'b1', createdAt: '2026-01-03' }, { slug: 'b2', createdAt: '2026-01-01' }],
    },
  ]);
  // Merged order: a1(04), b1(03), a2(02), b2(01). Window [1,2) is b1 alone.
  const result = await searchEverywhere(
    [
      { server: 'https://a.test', token: null },
      { server: 'https://b.test', token: null },
    ],
    { limit: 1, offset: 1 },
  );
  assert.deepEqual(result.jobs.map((h) => h.job.slug), ['b1']);
  assert.equal(result.total, 4);
});

test('a single board with a nonzero offset still serves its window', async (t) => {
  stubFetch(t, [
    {
      server: 'https://a.test',
      items: [
        { slug: 'a1', createdAt: '2026-01-05' },
        { slug: 'a2', createdAt: '2026-01-04' },
        { slug: 'a3', createdAt: '2026-01-03' },
      ],
    },
  ]);
  const result = await searchEverywhere(
    [{ server: 'https://a.test', token: null }],
    { limit: 1, offset: 2 },
  );
  assert.deepEqual(result.jobs.map((h) => h.job.slug), ['a3']);
});

test('an unqualified search returns no more than the default page size', async (t) => {
  const many = Array.from({ length: 30 }, (_, i) => ({
    slug: `a${i}`,
    createdAt: `2026-01-${String(31 - i).padStart(2, '0')}`,
  }));
  stubFetch(t, [{ server: 'https://a.test', items: many }]);
  const result = await searchEverywhere([{ server: 'https://a.test', token: null }], {});
  assert.equal(result.jobs.length, 25);
  assert.equal(result.jobs[0]?.job.slug, 'a0');
});

test('a board is paged until its share of the window is covered', async (t) => {
  const many = Array.from({ length: 150 }, (_, i) => ({
    slug: `a${i}`,
    createdAt: new Date(Date.UTC(2026, 2, 1) - i * 60_000).toISOString(),
  }));
  const calls = stubFetch(t, [{ server: 'https://a.test', items: many }]);
  const result = await searchEverywhere(
    [{ server: 'https://a.test', token: null }],
    { limit: 5, offset: 140 },
  );
  assert.deepEqual(
    result.jobs.map((h) => h.job.slug),
    ['a140', 'a141', 'a142', 'a143', 'a144'],
  );
  // 145 prefix rows in pages of at most 100 means two fetches.
  const searchCalls = calls.filter((u) => u.includes('/api/v1/jobs'));
  assert.equal(searchCalls.length, 2, searchCalls.join(','));
  assert.match(searchCalls[0] ?? '', /limit=100/);
  assert.match(searchCalls[1] ?? '', /limit=45&offset=100|offset=100&limit=45/);
});

test('the timeout budget covers every page a board is asked for', async (t) => {
  const many = Array.from({ length: 150 }, (_, i) => ({
    slug: `a${i}`,
    createdAt: new Date(Date.UTC(2026, 2, 1) - i * 60_000).toISOString(),
  }));
  t.mock.method(
    globalThis,
    'fetch',
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const limit = Number(url.searchParams.get('limit') ?? '25');
      const offset = Number(url.searchParams.get('offset') ?? '0');
      // The second page stalls past the budget, honoring the abort signal so
      // the in-flight request dies rather than only the next one failing.
      if (offset === 100) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 250);
          init?.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      }
      return Response.json({ items: many.slice(offset, offset + limit), total: many.length });
    },
  );
  const result = await searchEverywhere(
    [{ server: 'https://a.test', token: null }],
    { limit: 5, offset: 140 },
    { timeoutMs: 100 },
  );
  assert.equal(result.sources[0]?.ok, false);
  assert.equal(result.jobs.length, 0, 'a timed-out board contributes nothing');
  assert.equal(result.total, 0);
});

test('a board that fails mid-prefix contributes nothing, and the rest still count', async (t) => {
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.hostname === 'broken.test' && url.searchParams.get('offset') === '100') {
      return Response.json({ items: [], total: 'NaN' });
    }
    const items =
      url.hostname === 'broken.test'
        ? Array.from({ length: 200 }, (_, i) => ({
            slug: `b${i}`,
            createdAt: new Date(Date.UTC(2026, 0, 2) - i * 60_000).toISOString(),
          }))
        : Array.from({ length: 60 }, (_, i) => ({
            slug: `h${i}`,
            createdAt: new Date(Date.UTC(2026, 1, 1) - i * 60_000).toISOString(),
          }));
    const limit = Number(url.searchParams.get('limit') ?? '25');
    const offset = Number(url.searchParams.get('offset') ?? '0');
    return Response.json({
      items: items.slice(offset, offset + limit),
      total: items.length,
    });
  });
  // want = 50 + 60 = 110 > 100, so the broken board is asked for a second
  // page; that page is invalid, so its first hundred hits must not leak in.
  const result = await searchEverywhere(
    [
      { server: 'https://broken.test', token: null },
      { server: 'https://healthy.test', token: null },
    ],
    { limit: 60, offset: 50 },
  );
  assert.equal(result.sources[0]?.ok, false);
  assert.deepEqual(
    result.jobs.map((h) => h.job.slug),
    ['h50', 'h51', 'h52', 'h53', 'h54', 'h55', 'h56', 'h57', 'h58', 'h59'],
  );
  assert.equal(result.total, 60, 'the failed board drops out of the total too');
});

test('a board with fewer hits than the window still reports its real total', async (t) => {
  stubFetch(t, [
    { server: 'https://a.test', items: [{ slug: 'a1', createdAt: '2026-01-02' }], total: 3 },
    { server: 'https://b.test', items: [{ slug: 'b1', createdAt: '2026-01-01' }], total: 2 },
  ]);
  const result = await searchEverywhere(
    [
      { server: 'https://a.test', token: null },
      { server: 'https://b.test', token: null },
    ],
    { limit: 10 },
  );
  assert.equal(result.jobs.length, 2);
  assert.equal(result.total, 5);
  assert.equal(result.sources[0]?.total, 3);
  assert.equal(result.sources[1]?.total, 2);
});
