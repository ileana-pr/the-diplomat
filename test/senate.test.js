import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickDownloads, senateVotes } from '../lib/federal.js';
import { memoryStore } from '../lib/senate-db.js';

const MINUTE = 60 * 1000;
const START = Date.parse('2026-11-12T12:00:00Z');

// a made-up senate.gov. `tallies` maps a roll call number to its yea count.
function fakeSenate(tallies, { refuse = false } = {}) {
  const site = { tallies, refuse, lists: 0, files: [] };
  const row = (n) => `<vote><vote_number>${String(n).padStart(5, '0')}</vote_number><vote_date>10-Nov</vote_date><issue>PN${n}</issue><question>On the Nomination</question><result>Confirmed</result><vote_tally><yeas>${site.tallies[n]}</yeas><nays>40</nays></vote_tally><title>Sample nominee ${n}</title></vote>`;
  const file = (n) => `<roll_call_vote><vote_number>${n}</vote_number><vote_date>November 10, 2026, 05:30 PM</vote_date><vote_question_text>On the Nomination PN${n}</vote_question_text><vote_result_text>Nomination Confirmed</vote_result_text><vote_title>Sample nominee ${n}</vote_title><document><document_name>PN${n}</document_name></document><count><yeas>${site.tallies[n]}</yeas><nays>40</nays></count><members><member><last_name>Senatorson</last_name><state>VA</state><vote_cast>Nay</vote_cast><lis_member_id>S001</lis_member_id></member><member><last_name>Elsewhere</last_name><state>MD</state><vote_cast>Yea</vote_cast><lis_member_id>S003</lis_member_id></member></members></roll_call_vote>`;
  globalThis.fetch = async (url) => {
    url = String(url);
    if (site.refuse) return new Response('Access Denied', { status: 403, statusText: 'Forbidden' });
    if (url.includes('vote_menu_')) {
      site.lists++;
      const numbers = Object.keys(site.tallies).map(Number).sort((a, b) => b - a);
      return new Response(`<vote_summary><congress_year>2026</congress_year><votes>${numbers.map(row).join('')}</votes></vote_summary>`);
    }
    const m = url.match(/vote_\d+_\d_(\d+)\.xml$/);
    if (m) {
      site.files.push(+m[1]);
      return new Response(file(+m[1]));
    }
    return new Response('not mocked', { status: 404, statusText: 'Not Found' });
  };
  return site;
}

const tallies = (from, to, yeas = 50) => Object.fromEntries(Array.from({ length: to - from + 1 }, (_, i) => [from + i, yeas]));

test('each visit downloads up to 20 files it does not have, newest first', async () => {
  const site = fakeSenate(tallies(1, 45));
  const store = memoryStore();

  const first = await senateVotes(119, 2, 'VA', { store, now: START });
  assert.deepEqual(site.files, Array.from({ length: 20 }, (_, i) => 45 - i));
  assert.equal(first.added, 20);
  assert.equal(first.votes.length, 20);

  const second = await senateVotes(119, 2, 'VA', { store, now: START + MINUTE });
  assert.deepEqual(site.files.slice(20), Array.from({ length: 20 }, (_, i) => 25 - i));
  assert.equal(second.votes.length, 40);

  const third = await senateVotes(119, 2, 'VA', { store, now: START + 2 * MINUTE });
  assert.equal(third.added, 5);
  assert.equal(third.votes.length, 45);
  assert.equal(site.lists, 1, 'the list is downloaded once in 15 minutes');
});

test('a vote that matches the list is not downloaded again', async () => {
  const site = fakeSenate(tallies(1, 3));
  const store = memoryStore();
  await senateVotes(119, 2, 'VA', { store, now: START });
  assert.equal(site.files.length, 3);

  const later = await senateVotes(119, 2, 'VA', { store, now: START + 16 * MINUTE });
  assert.equal(site.lists, 2, 'the list is checked again after 15 minutes');
  assert.equal(site.files.length, 3, 'no vote file is downloaded twice');
  assert.equal(later.added + later.updated, 0);
  assert.equal(later.votes.length, 3);
});

test('a changed tally is downloaded before votes we do not have', async () => {
  const site = fakeSenate(tallies(1, 3));
  const store = memoryStore();
  await senateVotes(119, 2, 'VA', { store, now: START });

  // the senate corrects roll call 2 and holds 27 more votes.
  site.tallies = { ...tallies(1, 30), 2: 51 };
  site.files = [];
  const later = await senateVotes(119, 2, 'VA', { store, now: START + 16 * MINUTE });
  assert.equal(site.files[0], 2, 'the corrected vote goes first');
  assert.deepEqual(site.files.slice(1), Array.from({ length: 19 }, (_, i) => 30 - i));
  assert.equal(later.updated, 1);
  assert.equal(later.added, 19);
  assert.equal(later.votes.find((v) => v.number === 2).yeas, 51);
  assert.equal(later.votes.length, 22);
});

test('only the senators for the state asked about are returned', async () => {
  fakeSenate(tallies(1, 1));
  const store = memoryStore();
  const va = await senateVotes(119, 2, 'VA', { store, now: START });
  assert.deepEqual(va.votes[0].positions, { S001: 'Nay', 'VA:senatorson': 'Nay' });
  assert.match(va.votes[0].url, /vote1192\/vote_119_2_00001\.htm$/);
  const md = await senateVotes(119, 2, 'MD', { store, now: START });
  assert.deepEqual(md.votes[0].positions, { S003: 'Yea', 'MD:elsewhere': 'Yea' });
});

test('saved votes still show when senate.gov refuses', async () => {
  const site = fakeSenate(tallies(1, 3));
  const store = memoryStore();
  await senateVotes(119, 2, 'VA', { store, now: START });

  site.refuse = true;
  const later = await senateVotes(119, 2, 'VA', { store, now: START + 16 * MINUTE });
  assert.equal(later.votes.length, 3);
  assert.match(later.problem, /403/);

  await assert.rejects(senateVotes(119, 2, 'VA', { store: memoryStore(), now: START }), /403/);
});

test('a page that is not a vote file is not saved', async () => {
  const site = fakeSenate(tallies(1, 2));
  const store = memoryStore();
  const real = globalThis.fetch;
  // senate.gov sometimes answers 200 with a refusal page.
  globalThis.fetch = async (url) => (String(url).endsWith('_00002.xml') ? new Response('<html>Access Denied</html>') : real(url));
  const first = await senateVotes(119, 2, 'VA', { store, now: START });
  assert.deepEqual(first.votes.map((v) => v.number), [1]);

  globalThis.fetch = real;
  const retry = await senateVotes(119, 2, 'VA', { store, now: START + 3 * MINUTE });
  assert.deepEqual(retry.votes.map((v) => v.number), [2, 1]);
  assert.deepEqual(site.files, [1, 2]);
});

test('two visits at once do not download the same file', async () => {
  const store = memoryStore();
  await store.saveList(119, 2, [{ number: 1, mark: 'a' }, { number: 2, mark: 'b' }], START);
  const pending = await store.pending(119, 2, START);
  assert.deepEqual(await store.claim(119, 2, pending.map((r) => r.number), START), [1, 2]);
  assert.deepEqual(await store.claim(119, 2, [1, 2], START + MINUTE), []);
  assert.deepEqual(await store.pending(119, 2, START + MINUTE), []);
  assert.deepEqual(await store.claim(119, 2, [1, 2], START + 3 * MINUTE), [1, 2], 'a stalled download is tried again');
});

test('the download list stops at 20, with changed files first', () => {
  const missing = Array.from({ length: 30 }, (_, i) => ({ number: 100 + i, listMark: 'x', fileMark: null }));
  const changed = [{ number: 5, listMark: 'new', fileMark: 'old' }, { number: 9, listMark: 'new', fileMark: 'old' }];
  const picked = pickDownloads([...missing, ...changed]);
  assert.equal(picked.length, 20);
  assert.deepEqual(picked.slice(0, 3).map((r) => r.number), [9, 5, 129]);
  assert.equal(picked.at(-1).number, 112);
});
