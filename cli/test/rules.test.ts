// The tables the agent's next move depends on: a refusal's next step, when `wait` is done, how
// polling backs off, and where the edit link points.

import { describe, expect, test } from 'bun:test';
import { backoffDelays } from '../src/client';
import { NETWORK_STEP, nextStepFor, nextSteps, SERVER_STEP } from '../src/errors';
import { proxyFor } from '../src/http';
import { appUrl, waitDecision } from '../src/video';

// Every code the API can answer an API key with (services/backend/internal/transport).
const API_KEY_CODES = [
  'api_key_invalid',
  'api_key_revoked',
  'api_key_not_allowed',
  'insufficient_scope',
  'agent_api_off',
  'plan_required',
  'allowance_used',
  'api_key_daily_limit',
  'api_key_rate_limited',
  'agent_spend_limit',
  'export_limit',
  'idempotency_in_progress',
  'idempotency_key_reused',
  'idempotency_key_required',
  'project_not_found',
  'plan_changed',
  'not_exported',
  'edit_timing_off',
  'landscape_off',
  // upload-url (create-project-upload-from-url, get-project-upload)
  'url_not_allowed',
  'url_not_public',
  'url_unreachable',
  'not_a_video',
  'video_too_large',
  'video_too_long',
  'url_fetches_busy',
];

test('every refusal names a next step', () => {
  const steps = nextSteps('solara');
  for (const code of API_KEY_CODES) expect(nextStepFor(400, code)).toBe(steps[code] ?? `missing ${code}`);
  expect(nextStepFor(402, 'plan_required')).toContain('subscribe yourself');
  expect(nextStepFor(404, 'something_new')).toBe('Not found. Check the id.');
  expect(nextStepFor(503, '')).toBe(SERVER_STEP);
  expect(nextStepFor(0, '')).toBe(NETWORK_STEP); // no answer: the network, not a server error
  expect(nextStepFor(409, 'idempotency_in_progress', 'npx -y solaraai')).toContain('`npx -y solaraai status');
});

describe('wait', () => {
  test('knows an edit from an export', () => {
    const ready = { state: 'awaiting_approval', rev: 2, approved_rev: 1, video_url: 'https://v/1' };
    expect(waitDecision(ready, 'edit')).toBe('done');
    expect(waitDecision(ready, 'export')).toBe('working'); // rev 2 is not exported yet
    expect(waitDecision({ ...ready, approved_rev: 2 }, 'export')).toBe('done');
    expect(waitDecision({ state: 'rendering', rev: 2 }, 'export')).toBe('working');
    expect(waitDecision({ state: 'failed' }, 'edit')).toBe('failed');
    expect(waitDecision({ state: 'something_new' }, 'edit')).toBe('working');
  });

  test("a new project's edit is ready on its video plan", () => {
    // What the API answers once a new project's analysis is done (live on a slot, 2026-10-17): the
    // editor's video plan, waiting for Export. `wait` used to wait here until it timed out.
    const planned = { state: 'awaiting_plan_review', rev: 1, built_rev: 1, approved_rev: 0 };
    expect(waitDecision(planned, 'edit')).toBe('done');
    expect(waitDecision(planned, 'export')).toBe('working'); // nothing is exported yet
    expect(waitDecision({ state: 'processing', rev: 1 }, 'edit')).toBe('working');
  });

  test('polling backs off and stays bounded', () => {
    const delays = backoffDelays();
    const first = Array.from({ length: 12 }, () => delays.next().value);
    expect(first[0]).toBeGreaterThanOrEqual(4.5);
    expect(first[0]).toBeLessThanOrEqual(5.5);
    expect(first.every((delay) => delay <= 33)).toBe(true);
    expect(first.at(-1)).toBeGreaterThanOrEqual(27);
  });
});

test("the edit link is the app's", () => {
  expect(appUrl('https://api.solaraai.com')).toBe('https://app.solaraai.com');
  expect(appUrl('https://eu-api.example.com')).toBe('https://eu-app.example.com');
  expect(appUrl('http://localhost:8080', 'http://localhost:3000/')).toBe('http://localhost:3000');
});

test('proxies apply as curl reads them, and never to this machine', () => {
  const env = { https_proxy: 'http://proxy:3128', HTTP_PROXY: 'proxy:8080', NO_PROXY: '.internal.example,other.test' };
  expect(proxyFor(new URL('https://api.solaraai.com/x'), env)?.href).toBe('http://proxy:3128/');
  expect(proxyFor(new URL('http://api.solaraai.com/x'), env)?.href).toBe('http://proxy:8080/');
  expect(proxyFor(new URL('https://s3.internal.example/x'), env)).toBeNull();
  expect(proxyFor(new URL('https://other.test/x'), env)).toBeNull();
  expect(proxyFor(new URL('http://127.0.0.1:9/x'), env)).toBeNull();
  expect(proxyFor(new URL('https://api.solaraai.com/x'), {})).toBeNull();
});
