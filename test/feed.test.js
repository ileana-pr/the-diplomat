import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installMockFetch } from './mock-fetch.js';
import { currentCongress } from '../lib/federal.js';
import { buildFeed } from '../lib/feed.js';
import { clearCache } from '../lib/http.js';
import { resetSenateStore } from '../lib/senate-db.js';
import { beforeEach } from 'node:test';

const filledCounties = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'counties.json');
beforeEach(() => {
  clearCache();
  resetSenateStore();
  process.env.COUNTIES_FILE = filledCounties;
});

test('current congress and session', () => {
  assert.deepEqual(currentCongress(new Date('2026-11-06')), { congress: 119, session: 2, year: 2026 });
  assert.deepEqual(currentCongress(new Date('2027-02-01')), { congress: 120, session: 1, year: 2027 });
});

test('builds a full feed for an Orange County address', async () => {
  const calls = installMockFetch();
  const data = await buildFeed('100 Sample St, Orange, VA 22960', { CONGRESS_API_KEY: 'k', OPENSTATES_API_KEY: 'os' });
  assert.equal(data.location.county, 'Orange County');
  assert.equal(data.location.congressionalDistrict, 7);
  assert.deepEqual(data.officials.federal.map((o) => o.name), ['Alex Senatorson', 'Jordan Upperhouse', 'Casey Districtseven']);
  assert.deepEqual(data.officials.state.map((o) => o.role), ['Virginia State Senator', 'Virginia Delegate']);
  assert.equal(data.officials.county.length, 5);

  const kinds = new Set(data.feed.map((i) => `${i.level}:${i.kind}`));
  for (const k of ['federal:vote', 'federal:sponsored', 'state:vote', 'state:sponsored', 'county:meeting', 'county:minutes', 'county:news']) assert.ok(kinds.has(k), `missing ${k}`);

  const houseVote = data.feed.find((i) => i.kind === 'vote' && i.chamber === 'house');
  assert.equal(houseVote.officials.length, 1, 'only my representative, not the other VA member');
  assert.equal(houseVote.officials[0].name, 'Casey Districtseven');
  const senVote = data.feed.find((i) => i.kind === 'vote' && i.chamber === 'senate');
  assert.deepEqual(senVote.officials.map((o) => o.position), ['Nay', 'Yea']);
  assert.equal(data.sources.find((s) => s.name === 'Senate votes').detail, '2 roll calls saved, 2 new');
  assert.ok(!data.feed.some((i) => i.title === undefined), 'amendments are skipped');
  const fedBills = data.feed.filter((i) => i.level === 'federal' && i.billLabel === 'H.R. 4321');
  assert.equal(fedBills.length, 1, 'one card per bill');
  assert.equal(fedBills[0].officials.length, 3);
  assert.match(data.feed.find((i) => i.kind === 'sponsored').url, /119th-congress\/house-bill\/4321$/);
  for (let i = 1; i < data.feed.length; i++) assert.ok(data.feed[i - 1].date >= data.feed[i].date, 'newest first');
  assert.ok(data.sources.every((s) => s.ok), JSON.stringify(data.sources));
  assert.ok(calls.some((c) => c.headers?.['X-API-KEY'] === 'os'));
});

test('works without API keys, showing district placeholders', async () => {
  installMockFetch();
  const data = await buildFeed('100 Sample St, Orange, VA 22960', {});
  assert.equal(data.officials.state[0].placeholder, true);
  assert.match(data.officials.state[1].name, /House of Delegates District 62/);
  assert.ok(data.feed.some((i) => i.level === 'federal'));
  assert.ok(data.sources.some((s) => !s.ok && /Open States/.test(s.detail)));
});

test('house votes load when the clerk index page is missing', async () => {
  installMockFetch({ houseIndexMissing: true });
  const data = await buildFeed('100 Sample St, Orange, VA 22960', { CONGRESS_API_KEY: 'k', OPENSTATES_API_KEY: 'os' });
  const house = data.sources.find((s) => s.name === 'House votes');
  assert.equal(house.ok, true, house.detail);
  const houseVote = data.feed.find((i) => i.kind === 'vote' && i.chamber === 'house');
  assert.equal(houseVote.officials[0].name, 'Casey Districtseven');
});

test('a senate.gov refusal leaves the rest of the feed', async () => {
  installMockFetch({ blockSenate: true });
  const data = await buildFeed('100 Sample St, Orange, VA 22960', { CONGRESS_API_KEY: 'k', OPENSTATES_API_KEY: 'os' });
  const senate = data.sources.find((s) => s.name === 'Senate votes');
  assert.equal(senate.ok, false, senate.detail);
  assert.equal(data.feed.some((i) => i.kind === 'vote' && i.chamber === 'senate'), false);
  const houseVote = data.feed.find((i) => i.kind === 'vote' && i.chamber === 'house');
  assert.equal(houseVote.officials[0].name, 'Casey Districtseven');
});

test('a census-only county shows its name and no meetings', async () => {
  const file = path.join(os.tmpdir(), 'diplomat-counties-census.json');
  fs.writeFileSync(file, JSON.stringify({ '51137': { geoid: '51137', name: 'Orange County', state: 'VA' } }));
  process.env.COUNTIES_FILE = file;
  installMockFetch();
  const data = await buildFeed('100 Sample St, Orange, VA 22960', { CONGRESS_API_KEY: 'k', OPENSTATES_API_KEY: 'os' });
  assert.equal(data.county.name, 'Orange County');
  assert.equal(data.county.state, 'VA');
  assert.equal(data.officials.county.length, 0);
  assert.equal(data.feed.some((i) => i.level === 'county'), false);
  const note = data.sources.find((s) => s.name === 'County agendas & news');
  assert.equal(note.ok, true, note.detail);
  assert.match(note.detail, /aren't filled in yet/);
});

test('a failing source does not break the feed', async () => {
  installMockFetch({ failOpenStates: true });
  const data = await buildFeed('200 Sample St, Orange, VA 22960', { OPENSTATES_API_KEY: 'bad' });
  assert.ok(data.feed.length > 0);
  assert.ok(data.sources.some((s) => !s.ok && /401/.test(s.detail)));
});
