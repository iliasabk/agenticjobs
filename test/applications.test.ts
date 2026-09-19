import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateApplication, submitApplication } from '../dist/core/applications.js';

const schema = {
  fields: [
    { name: 'name', label: 'Name', type: 'text' as const, required: true, maxLength: 120 },
  ],
};

test('a disclose policy requires the agent field instead of accepting omission', () => {
  const missing = validateApplication(schema, { name: 'Ada' }, 'disclose');
  assert.equal(missing.ok, false);
  if (missing.ok) return;
  assert.deepEqual(missing.problems, [
    {
      field: 'agent',
      message: 'This employer asks applications written with an agent to say so.',
    },
  ]);

  const valid = validateApplication(
    schema,
    { name: 'Ada', agent: { name: 'test-agent', supervised: true } },
    'disclose',
  );
  assert.equal(valid.ok, true);
});

test('submitting a draft with a malformed id is a miss, not a database error', async () => {
  // POST /api/v1/applications/:id/submit hands the path segment to the query.
  // A string that is not a uuid makes Postgres raise `invalid input syntax
  // for type uuid` - a 500 for what is really "no such draft", which is why
  // decideApplication checks the shape first.
  let reached = false;
  const pool = {
    query: async () => {
      reached = true;
      return { rows: [], rowCount: 0 };
    },
  };
  const sent = await submitApplication(
    pool as never,
    'not-a-uuid',
    '00000000-0000-4000-8000-000000000000',
  );
  assert.equal(sent, false);
  assert.equal(reached, false, 'a malformed id never reaches the database');
});
