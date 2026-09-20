/**
 * Pay badges in federated search.
 *
 * A network result is a job from somebody else's board, served by whatever
 * version that board runs: a current one sends `pay`, an old one sends only
 * `salary`, and a listing can still say nothing at all. The badge has to show
 * the same thing a local job card shows for each of those.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EMPTY_QUERY } from '../dist/schema/query.js';
import { NetworkSearchPage } from '../dist/views/network.js';

function job(over: Record<string, unknown> = {}) {
  return {
    id: 'j1',
    slug: 'a-role',
    title: 'A role',
    description: '',
    org: { slug: 'org', name: 'Org' },
    employmentType: 'contract',
    workplace: 'remote',
    seniority: null,
    location: null,
    remoteRegions: [],
    pay: {
      lines: [{ type: 'per-task', min: 0.25, max: 0.25, currency: 'USD', unit: 'task' }],
      method: null,
      equity: null,
      unpaid: false,
    },
    salary: { min: null, max: null, currency: 'USD', period: 'year', equity: null },
    tags: [],
    stack: [],
    requirements: [],
    responsibilities: [],
    agentPolicy: 'welcome',
    apply: { via: 'board', schema: { fields: [] } },
    status: 'published',
    publishedAt: '2026-09-01T00:00:00.000Z',
    expiresAt: null,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

function page(jobs: Record<string, unknown>[]) {
  const result = {
    jobs: jobs.map((j, i) => ({
      job: j,
      instance: `https://board-${i}.example`,
      instanceName: `Board ${i}`,
      url: `https://board-${i}.example/jobs/x`,
    })),
    sources: jobs.map((_, i) => ({
      instance: `https://board-${i}.example`,
      name: `Board ${i}`,
      ok: true,
      count: 1,
      total: 1,
      ms: 1,
      error: null,
    })),
    total: jobs.length,
  };
  return String(NetworkSearchPage({ result, query: EMPTY_QUERY }));
}

test('a per-task price renders instead of an empty salary range', () => {
  const html = page([job()]);
  assert.match(html, /\$0\.25/, html.match(/job-salary[^<]*<\/span>/)?.[0]);
});

test('a per-PR price renders instead of an empty salary range', () => {
  const html = page([
    job({
      pay: {
        lines: [{ type: 'per-task', min: 0.25, max: 0.25, currency: 'USD', unit: 'PR' }],
        method: null,
        equity: null,
        unpaid: false,
      },
    }),
  ]);
  assert.match(html, /\$0\.25/);
});

test('mixed compensation keeps its additional-line indicator', () => {
  const html = page([
    job({
      pay: {
        lines: [
          { type: 'yearly', min: 90000, max: 90000, currency: 'USD', unit: null },
          { type: 'per-task', min: 10, max: 10, currency: 'USD', unit: 'task' },
        ],
        method: null,
        equity: null,
        unpaid: false,
      },
      salary: { min: 90000, max: 90000, currency: 'USD', period: 'year', equity: null },
    }),
  ]);
  assert.match(html, /\+1/, 'a second pay line must be indicated, not dropped');
});

test('an explicit unpaid statement renders, and an obsolete salary does not replace it', () => {
  const html = page([
    job({
      pay: { lines: [], method: null, equity: null, unpaid: true },
      salary: { min: 50000, max: 70000, currency: 'USD', period: 'year', equity: null },
    }),
  ]);
  assert.match(html, /Unpaid/);
  assert.ok(!/50,000/.test(html), 'a stale salary range must not override an unpaid statement');
});

test('a plain pay line renders the same as on a local card', () => {
  const html = page([
    job({
      pay: {
        lines: [{ type: 'yearly', min: 90000, max: 120000, currency: 'EUR', unit: null }],
        method: null,
        equity: null,
        unpaid: false,
      },
      salary: { min: 90000, max: 120000, currency: 'EUR', period: 'year', equity: null },
    }),
  ]);
  assert.match(html, /job-salary[^<]*90/, html.match(/job-salary[^>]*>[^<]*/)?.[0]);
});

test('an old board serving only salary still gets its badge', () => {
  const legacy = job({ pay: undefined });
  legacy.salary = { min: 80000, max: 80000, currency: 'USD', period: 'year', equity: null };
  const html = page([legacy]);
  assert.match(html, /\$80k/, 'the legacy salary fallback must still render');
});

test('a listing that says nothing about pay gets no badge', () => {
  const silent = job({ pay: { lines: [], method: null, equity: null, unpaid: false } });
  const html = page([silent]);
  assert.ok(!html.includes('job-salary'), 'no pay statement must render no badge');
});
