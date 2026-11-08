import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installMockFetch } from './mock-fetch.js';
import { currentCongress } from '../lib/federal.js';
import { buildFeed } from '../lib/feed.js';
import { clearCache } from '../lib/http.js';
import { beforeEach } from 'node:test';

const emptyStore = path.join(os.tmpdir(), 'diplomat-senate-test');
beforeEach(() => {
  clearCache();
  fs.rmSync(emptyStore, { recursive: true, force: true });
  fs.mkdirSync(emptyStore, { recursive: true });
  process.env.SENATE_STORE_DIR = emptyStore;
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

test('saved senate files are used without calling senate.gov', async () => {
  const { congress, session } = currentCongress();
  const menu = `<?xml version="1.0"?><vote_summary><votes><vote><vote_number>00256</vote_number></vote></votes></vote_summary>`;
  const vote = `<?xml version="1.0"?><roll_call_vote><vote_number>00256</vote_number><vote_date>September 30, 2026, 05:30 PM</vote_date><vote_question_text>On the Nomination PN256</vote_question_text><vote_result_text>Nomination Confirmed</vote_result_text><vote_title>Confirmation of a sample nominee 256</vote_title><document><document_name>PN256</document_name></document><count><yeas>47</yeas><nays>41</nays></count><members><member><last_name>Senatorson</last_name><state>VA</state><vote_cast>Nay</vote_cast><lis_member_id>S001</lis_member_id></member><member><last_name>Upperhouse</last_name><state>VA</state><vote_cast>Yea</vote_cast><lis_member_id>S002</lis_member_id></member></members></roll_call_vote>`;
  fs.writeFileSync(path.join(emptyStore, `vote_menu_${congress}_${session}.xml`), menu);
  fs.writeFileSync(path.join(emptyStore, `vote_${congress}_${session}_00256.xml`), vote);
  fs.writeFileSync(path.join(emptyStore, 'status.json'), JSON.stringify({ updatedAt: '2026-09-30T18:00:00Z' }));
  const calls = installMockFetch({ blockSenate: true });
  const data = await buildFeed('100 Sample St, Orange, VA 22960', { CONGRESS_API_KEY: 'k', OPENSTATES_API_KEY: 'os' });
  const senate = data.sources.find((s) => s.name === 'Senate votes');
  assert.equal(senate.ok, true, senate.detail);
  assert.match(senate.detail, /saved Senate files/);
  assert.equal(calls.some((c) => String(c.url).includes('senate.gov') || String(c.url).includes('voteview.com')), false);
  const senVote = data.feed.find((i) => i.kind === 'vote' && i.chamber === 'senate');
  assert.deepEqual(senVote.officials.map((o) => o.position), ['Nay', 'Yea']);
});

test('senate votes fall back to voteview when senate.gov returns 403', async () => {
  installMockFetch({ blockSenate: true });
  const data = await buildFeed('100 Sample St, Orange, VA 22960', { CONGRESS_API_KEY: 'k', OPENSTATES_API_KEY: 'os' });
  const senate = data.sources.find((s) => s.name === 'Senate votes');
  assert.equal(senate.ok, true, senate.detail);
  assert.match(senate.detail, /Voteview/);
  const senVote = data.feed.find((i) => i.kind === 'vote' && i.chamber === 'senate');
  assert.deepEqual(senVote.officials.map((o) => o.position), ['Nay', 'Yea']);
});

test('a failing source does not break the feed', async () => {
  installMockFetch({ failOpenStates: true });
  const data = await buildFeed('200 Sample St, Orange, VA 22960', { OPENSTATES_API_KEY: 'bad' });
  assert.ok(data.feed.length > 0);
  assert.ok(data.sources.some((s) => !s.ok && /401/.test(s.detail)));
});
