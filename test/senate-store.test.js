import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSenateFetches } from '../lib/senate-store.js';

const row = (num, yeas) => `<vote><vote_number>${num}</vote_number><vote_date>30-Sep</vote_date><issue>PN${num}</issue><question>On the Nomination</question><result>Confirmed</result><vote_tally><yeas>${yeas}</yeas><nays>41</nays></vote_tally><title>Nominee ${num}</title></vote>`;
const menu = (rows) => `<vote_summary><votes>${rows.join('')}</votes></vote_summary>`;

test('a saved vote is skipped when the list still matches', () => {
  const xml = menu([row('00256', 47), row('00255', 53)]);
  const plan = planSenateFetches({
    oldMenu: xml,
    newMenu: xml,
    hasFile: () => true,
  });
  assert.deepEqual(plan.fetch, []);
  assert.equal(Object.keys(plan.synced).length, 2);
});

test('a missing vote is downloaded and a changed tally is downloaded first', () => {
  const oldMenu = menu([row('00256', 47), row('00255', 53), row('00254', 50)]);
  const newMenu = menu([row('00256', 48), row('00255', 53), row('00254', 50)]);
  const plan = planSenateFetches({
    oldMenu,
    newMenu,
    hasFile: (num) => num !== '00254',
    limit: 5,
  });
  assert.deepEqual(plan.fetch, ['00256', '00254']);
  assert.notEqual(plan.synced['00256'], undefined);
  assert.equal(plan.synced['00255'] !== undefined, true);
});

test('only a few missing votes are fetched per pass, newest first', () => {
  const rows = ['00005', '00004', '00003', '00002', '00001'].map((n) => row(n, 40));
  const plan = planSenateFetches({
    oldMenu: '',
    newMenu: menu(rows),
    hasFile: () => false,
    limit: 2,
  });
  assert.deepEqual(plan.fetch, ['00005', '00004']);
});

test('a failed correction stays queued after the new list is already saved', () => {
  const oldMenu = menu([row('00256', 47)]);
  const newMenu = menu([row('00256', 48)]);
  const first = planSenateFetches({ oldMenu, newMenu, hasFile: () => true });
  const second = planSenateFetches({
    oldMenu: newMenu,
    newMenu,
    hasFile: () => true,
    synced: first.synced,
  });
  assert.deepEqual(second.fetch, ['00256']);
});
