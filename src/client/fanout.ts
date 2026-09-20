/**
 * Asking every board you are signed in to, at once.
 *
 * The directory's federated search covers boards that opted into being listed.
 * This covers the other case, which is the one a person actually has: three
 * boards in their config, one of them private to their employer and listed
 * nowhere. Same guarantees - parallel, per-board timeout, a board that fails
 * is named rather than silently dropped.
 */

import type { Job, JobQuery } from '../schema/index.ts';
import { annualisedTopSalary } from '../schema/salary.ts';
import { MAX_LIMIT } from '../schema/query.ts';
import { BoardClient } from './client.ts';
import { loadConfig, type BoardConfig } from './config.ts';

export interface FanoutHit {
  job: Job;
  server: string;
  boardName: string;
  url: string;
}

export interface FanoutSource {
  server: string;
  name: string;
  ok: boolean;
  count: number;
  total: number;
  ms: number;
  error: string | null;
}

export interface FanoutResult {
  jobs: FanoutHit[];
  sources: FanoutSource[];
  total: number;
}

export function configuredBoards(): BoardConfig[] {
  const config = loadConfig();
  return Object.values(config.boards);
}

export async function searchEverywhere(
  boards: BoardConfig[],
  query: Partial<JobQuery>,
  options: { timeoutMs?: number } = {},
): Promise<FanoutResult> {
  const sources: FanoutSource[] = boards.map((board) => ({
    server: board.server,
    name: board.name ?? hostOf(board.server),
    ok: false,
    count: 0,
    total: 0,
    ms: 0,
    error: null,
  }));
  const jobs: FanoutHit[] = [];

  // Pagination is global over the merged, sorted result, so a board cannot
  // be handed the caller's window: `offset` on every board would drop that
  // many of its hits and the merged page would be short. What the merge needs
  // instead is each board's own first `offset + limit` hits, fetched in pages
  // no larger than the shared MAX_LIMIT, and the window applied once at the end.
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(query.limit ?? 25) || 25));
  const offset = Math.min(100_000, Math.max(0, Math.trunc(query.offset ?? 0) || 0));
  const want = offset + limit;
  const budgetMs = options.timeoutMs ?? 20_000;

  await Promise.all(
    boards.map(async (board, index) => {
      const source = sources[index];
      if (source === undefined) return;
      const started = Date.now();
      try {
        const hits: FanoutHit[] = [];
        // One timeout budget per board across every page it takes to gather
        // its prefix; a slow board must not get a fresh allowance per request.
        while (hits.length < want) {
          const remaining = budgetMs - (Date.now() - started);
          if (remaining <= 0) throw new Error(`${board.server} did not answer in time.`);
          const pageLimit = Math.min(MAX_LIMIT, want - hits.length);
          const client = new BoardClient(board.server, {
            token: board.token,
            timeoutMs: remaining,
          });
          const page = await client.search({ ...query, limit: pageLimit, offset: hits.length });
          if (!Array.isArray(page?.items) || !Number.isSafeInteger(page.total) || page.total < 0) {
            throw new Error('The board returned an invalid search page.');
          }
          // Prepare the whole page first: a failed board must not contribute
          // partial hits while being excluded from the successful source totals.
          page.items.forEach((job) => {
            if (job === null || typeof job !== 'object' || typeof job.slug !== 'string') {
              throw new Error('The board returned an invalid search item.');
            }
            hits.push({
              job,
              server: board.server,
              boardName: source.name,
              url: `${board.server}/jobs/${job.slug}`,
            });
          });
          source.total = page.total;
          if (page.items.length < pageLimit) break;
        }
        jobs.push(...hits);
        source.count = hits.length;
        source.ok = true;
      } catch (error) {
        source.error = error instanceof Error ? error.message : String(error);
      } finally {
        source.ms = Date.now() - started;
      }
    }),
  );

  // Each board sorted its own prefix; "newest" across three boards is none of
  // those orders, so it is redone here before the one global window is cut.
  if (query.sort === 'salary') {
    jobs.sort((a, b) => annualisedTopSalary(b.job.salary) - annualisedTopSalary(a.job.salary));
  } else {
    jobs.sort((a, b) => published(b.job) - published(a.job));
  }
  return {
    jobs: jobs.slice(offset, offset + limit),
    sources,
    total: sources.reduce((sum, source) => sum + (source.ok ? source.total : 0), 0),
  };
}

function published(job: Job): number {
  return Date.parse(job.publishedAt ?? job.createdAt) || 0;
}

function hostOf(server: string): string {
  try {
    return new URL(server).hostname;
  } catch {
    return server;
  }
}
