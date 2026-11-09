import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertComplete, mergeCounties, parseGazetteer } from '../scripts/census-counties.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const sample = `USPS|GEOID|GEOIDFQ|ANSICODE|NAME|ALAND
VA|51137|0500000US51137|01494761|Orange County|882014693
PR|72001|0500000US72001|01804480|Adjuntas Municipio|172707710
`;

test('parses a census county file', () => {
  const rows = parseGazetteer(sample);
  assert.deepEqual(rows, [
    { geoid: '51137', name: 'Orange County', state: 'VA' },
    { geoid: '72001', name: 'Adjuntas Municipio', state: 'PR' },
  ]);
});

test('refuses a census file that is too small to be the full list', () => {
  assert.throws(() => assertComplete(parseGazetteer(sample)), /incomplete/);
});

test('refreshes names and leaves other fields alone', () => {
  const existing = {
    '51137': {
      geoid: '51137',
      name: 'Old Name',
      state: 'VA',
      website: 'https://example.gov',
      members: [{ name: 'A' }],
    },
    '99999': { geoid: '99999', name: 'Gone County', state: 'VA', website: 'https://gone.example' },
  };
  const merged = mergeCounties(existing, parseGazetteer(sample));
  assert.equal(merged['51137'].name, 'Orange County');
  assert.equal(merged['51137'].state, 'VA');
  assert.equal(merged['51137'].website, 'https://example.gov');
  assert.equal(merged['51137'].members[0].name, 'A');
  assert.equal(merged['72001'].name, 'Adjuntas Municipio');
  assert.equal(merged['72001'].website, undefined);
  assert.equal(merged['99999'], undefined);
});

test('the generated county list matches the 2025 census file', () => {
  const text = fs.readFileSync(path.join(root, 'data', 'counties.json'), 'utf8');
  const ids = [...text.matchAll(/^ {2}"(\d{5})":/gm)].map((match) => match[1]);
  assert.deepEqual(ids, [...ids].sort());
  assert.equal(ids[0], '01001');
  const data = JSON.parse(text);
  assert.equal(ids.length, 3222);
  assert.deepEqual(data['51137'], { geoid: '51137', name: 'Orange County', state: 'VA' });
  assert.deepEqual(data['72001'], { geoid: '72001', name: 'Adjuntas Municipio', state: 'PR' });
  assert.equal(data['09110'].name, 'Capitol Planning Region');
  assert.equal(data['09110'].state, 'CT');
  const puertoRico = ids.filter((id) => data[id].state === 'PR');
  assert.equal(puertoRico.length, 78);
  for (const id of ids) {
    assert.equal(data[id].geoid, id);
    assert.equal(typeof data[id].name, 'string');
    assert.match(data[id].state, /^[A-Z]{2}$/);
    assert.equal(data[id].website, undefined);
    assert.equal(data[id].members, undefined);
  }
});
