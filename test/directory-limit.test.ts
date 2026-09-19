/**
 * The directory's instance listing binds `limit` and `offset` straight into
 * the SQL. The route hands over `Number(param)`, so a querystring like
 * `?limit=abc` arrives as NaN and `?limit=2.5` as a fraction: neither is a
 * row count Postgres will take, and `Math.max` propagates NaN rather than
 * clamping it, so the request answered 500 instead of a page.
 *
 * The pool is faked: the check is which parameters get bound, not what a
 * database would answer.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listInstances } from '../src/directory/registry.ts';

type Pool = Parameters<typeof listInstances>[0];

function pool() {
  const asked: { text: string; values: unknown[] }[] = [];
  const fake = {
    asked,
    async query(text: string, values: unknown[] = []) {
      asked.push({ text, values });
      return { rows: [] };
    },
  };
  return fake as unknown as Pool & typeof fake;
}

function bound(pool: ReturnType<typeof pool>): { limit: unknown; offset: unknown } {
  const last = pool.asked.at(-1);
  assert.ok(last, 'listInstances asked nothing');
  // With no filters the two bound parameters are the limit and the offset.
  return { limit: last.values.at(-2), offset: last.values.at(-1) };
}

test('a non-numeric or fractional limit binds the default, not NaN', async () => {
  for (const limit of [NaN, 2.5, Infinity, -Infinity, Number('abc')]) {
    const fake = pool();
    await listInstances(fake, { limit });
    assert.equal(bound(fake).limit, 100, `limit=${limit}`);
  }
});

test('a fractional or non-numeric offset binds zero, not NaN', async () => {
  for (const offset of [NaN, 2.5, Infinity]) {
    const fake = pool();
    await listInstances(fake, { offset });
    assert.equal(bound(fake).offset, 0, `offset=${offset}`);
  }
});

test('integer limits and offsets still clamp to their range', async () => {
  const cases: { limit?: number; offset?: number; want: { limit: number; offset: number } }[] = [
    { limit: 0, want: { limit: 1, offset: 0 } },
    { limit: -5, want: { limit: 1, offset: 0 } },
    { limit: 9999, want: { limit: 500, offset: 0 } },
    { limit: 7, offset: -3, want: { limit: 7, offset: 0 } },
    { limit: 7, offset: 40, want: { limit: 7, offset: 40 } },
  ];
  for (const { limit, offset, want } of cases) {
    const fake = pool();
    await listInstances(fake, { limit, offset });
    assert.deepEqual(bound(fake), want, `limit=${limit} offset=${offset}`);
  }
});

test('an absent limit and offset still bind their defaults', async () => {
  const fake = pool();
  await listInstances(fake);
  assert.deepEqual(bound(fake), { limit: 100, offset: 0 });
});
