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

function districtNumber(g) {
  if (!g) return null;
  const raw = g.BASENAME ?? g.NAME ?? '';
  if (/at large/i.test(raw)) return 0;
  const n = parseInt(String(raw).replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

export function parseMatch(match) {
  const geos = match.geographies || {};
  const state = findLayer(geos, /^States$/i);
  const county = findLayer(geos, /^Counties$/i);
  const cd = findLayer(geos, /Congressional Districts/i);
  const upper = findLayer(geos, /Legislative Districts - Upper/i);
  const lower = findLayer(geos, /Legislative Districts - Lower/i);
  let cdNum = districtNumber(cd);
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
    stateSenateDistrict: districtNumber(upper),
    stateHouseDistrict: districtNumber(lower),
    stateSenateDistrictName: upper?.NAME,
    stateHouseDistrictName: lower?.NAME,
  };
}
