import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMatch } from '../lib/geo.js';

test('parseMatch keeps named and lettered state districts', () => {
  const geo = parseMatch({
    matchedAddress: '39 MAIN ST, MONTPELIER, VT, 05602',
    coordinates: { x: -72.57, y: 44.26 },
    addressComponents: { state: 'VT' },
    geographies: {
      States: [{ STUSAB: 'VT', NAME: 'Vermont' }],
      Counties: [{ NAME: 'Washington County', GEOID: '50023' }],
      '120th Congressional Districts': [{ NAME: 'Congressional District (at Large)', BASENAME: 'Congressional District (at Large)', CD119: '00' }],
      '2026 State Legislative Districts - Upper': [{ NAME: 'Washington Senatorial District', BASENAME: 'Washington' }],
      '2026 State Legislative Districts - Lower': [{ NAME: 'Washington-4 State House District', BASENAME: 'Washington-4' }],
    },
  });
  assert.equal(geo.state, 'VT');
  assert.equal(geo.congressionalDistrict, 0);
  assert.equal(geo.stateSenateDistrict, 'Washington');
  assert.equal(geo.stateHouseDistrict, 'Washington-4');
});

test('parseMatch keeps alaska letter districts and numeric house seats', () => {
  const geo = parseMatch({
    matchedAddress: '632 W 6TH AVE, ANCHORAGE, AK, 99501',
    coordinates: { x: -149.88, y: 61.21 },
    addressComponents: { state: 'AK' },
    geographies: {
      States: [{ STUSAB: 'AK', NAME: 'Alaska' }],
      Counties: [{ NAME: 'Anchorage Municipality', GEOID: '02020' }],
      '120th Congressional Districts': [{ NAME: 'Congressional District (at Large)', BASENAME: 'Congressional District (at Large)', CD119: '00' }],
      '2026 State Legislative Districts - Upper': [{ NAME: 'State Senate District I', BASENAME: 'I' }],
      '2026 State Legislative Districts - Lower': [{ NAME: 'State House District 17', BASENAME: '17' }],
    },
  });
  assert.equal(geo.stateSenateDistrict, 'I');
  assert.equal(geo.stateHouseDistrict, 17);
});
