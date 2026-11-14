import { getJSON } from './http.js';

// Turns a street address into coordinates and districts using the free Census geocoder.
export async function lookupAddress(address) {
  const url =
    'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?' +
    new URLSearchParams({ address, benchmark: 'Public_AR_Current', vintage: 'Current_Current', layers: 'all', format: 'json' });
  const data = await getJSON(url, { ttl: 24 * 3600 * 1000 });
  const match = data?.result?.addressMatches?.[0];
  if (!match) return null;
  return parseMatch(match);
}

function findLayer(geos, re) {
  const key = Object.keys(geos).find((k) => re.test(k));
  return key ? geos[key]?.[0] : null;
}

// congress districts are numbers (0 = at-large). state chambers may be numbers or names
// (vt "washington", ak "i", ma "third suffolk") — keep basename when it is not a plain digit.
function districtId(g, { numericOnly = false } = {}) {
  if (!g) return null;
  const raw = String(g.BASENAME ?? g.NAME ?? '').trim();
  if (!raw) return null;
  if (/at large/i.test(raw)) return 0;
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  if (numericOnly) {
    const n = parseInt(raw.replace(/\D/g, ''), 10);
    return Number.isFinite(n) ? n : null;
  }
  return raw;
}

export function parseMatch(match) {
  const geos = match.geographies || {};
  const state = findLayer(geos, /^States$/i);
  const county = findLayer(geos, /^Counties$/i);
  const cd = findLayer(geos, /Congressional Districts/i);
  const upper = findLayer(geos, /Legislative Districts - Upper/i);
  const lower = findLayer(geos, /Legislative Districts - Lower/i);
  let cdNum = districtId(cd, { numericOnly: true });
  // The Census codes at-large seats as 00 or 98.
  if (cd && /^(00|98)$/.test(String(Object.entries(cd).find(([k]) => /^CD\d+/.test(k))?.[1] ?? ''))) cdNum = 0;
  return {
    matchedAddress: match.matchedAddress,
    lat: match.coordinates?.y,
    lng: match.coordinates?.x,
    state: state?.STUSAB || match.addressComponents?.state,
    stateName: state?.NAME,
    county: county?.NAME,
    countyGeoid: county?.GEOID,
    congressionalDistrict: cdNum,
    congressionalDistrictName: cd?.NAME,
    stateSenateDistrict: districtId(upper),
    stateHouseDistrict: districtId(lower),
    stateSenateDistrictName: upper?.NAME,
    stateHouseDistrictName: lower?.NAME,
  };
}
