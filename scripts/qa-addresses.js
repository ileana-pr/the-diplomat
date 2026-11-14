// live census smoke: geocode ~20 real addresses and print districts + congress members for qa.
// run: npm run qa:addresses   (also runs at the end of npm test)
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { lookupAddress } from '../lib/geo.js';
import { findMembers } from '../lib/federal.js';

// public-ish street addresses across the map: city halls, main streets, known zips.
const ADDRESSES = [
  { label: 'VA Orange', address: '146 Madison Rd, Orange, VA 22960' },
  { label: 'CA Los Angeles', address: '200 N Spring St, Los Angeles, CA 90012' },
  { label: 'TX Austin', address: '301 W 2nd St, Austin, TX 78701' },
  { label: 'NY New York', address: '25 Broadway, New York, NY 10004' },
  { label: 'FL Miami', address: '3500 Pan American Dr, Miami, FL 33133' },
  { label: 'IL Chicago', address: '121 N LaSalle St, Chicago, IL 60602' },
  { label: 'WA Seattle', address: '600 4th Ave, Seattle, WA 98104' },
  { label: 'WY Cheyenne (at-large)', address: '2101 ONeil Ave, Cheyenne, WY 82001' },
  { label: 'VT Montpelier (at-large)', address: '39 Main St, Montpelier, VT 05602' },
  { label: 'AK Anchorage (at-large)', address: '632 W 6th Ave, Anchorage, AK 99501' },
  { label: 'NE Lincoln (unicameral)', address: '555 S 10th St, Lincoln, NE 68508' },
  { label: 'DC Washington', address: '1350 Pennsylvania Ave NW, Washington, DC 20004' },
  { label: 'HI Honolulu', address: '530 S King St, Honolulu, HI 96813' },
  { label: 'MA Boston', address: '1 City Hall Square, Boston, MA 02201' },
  { label: 'GA Atlanta', address: '55 Trinity Ave SW, Atlanta, GA 30303' },
  { label: 'AZ Phoenix', address: '200 W Washington St, Phoenix, AZ 85003' },
  { label: 'CO Denver', address: '1437 Bannock St, Denver, CO 80202' },
  { label: 'OH Columbus', address: '90 W Broad St, Columbus, OH 43215' },
  { label: 'LA New Orleans', address: '1300 Perdido St, New Orleans, LA 70112' },
  { label: 'PR San Juan', address: '153 Calle de la Fortaleza, San Juan, PR 00901' },
];

const NO_SENATE = new Set(['DC', 'PR', 'GU', 'VI', 'AS', 'MP']);

function fmtDistrict(n) {
  if (n == null) return '—';
  if (n === 0) return '0 (at-large)';
  return String(n);
}

async function checkOne(row) {
  const geo = await lookupAddress(row.address);
  if (!geo) {
    return { ...row, ok: false, error: 'no census match' };
  }

  let members = [];
  let memberError = '';
  try {
    members = await findMembers(geo.state, geo.congressionalDistrict);
  } catch (e) {
    memberError = e.message;
  }

  const senators = members.filter((m) => m.chamber === 'senate');
  const house = members.filter((m) => m.chamber === 'house');
  const issues = [];

  if (!geo.state) issues.push('missing state');
  if (geo.congressionalDistrict == null) issues.push('missing congressional district');
  if (!geo.countyGeoid) issues.push('missing county geoid');

  // fifty states normally have two senators; dc/territories do not.
  if (geo.state && !NO_SENATE.has(geo.state) && senators.length !== 2) {
    issues.push(`expected 2 senators, got ${senators.length}`);
  }
  if (geo.state && NO_SENATE.has(geo.state) && senators.length !== 0) {
    issues.push(`expected 0 senators for ${geo.state}, got ${senators.length}`);
  }
  if (geo.congressionalDistrict != null && house.length !== 1) {
    issues.push(`expected 1 house member, got ${house.length}`);
  }

  // nebraska is unicameral: census often has upper only.
  if (geo.state === 'NE') {
    if (geo.stateSenateDistrict == null) issues.push('NE missing unicameral district (upper)');
  } else if (geo.state && !NO_SENATE.has(geo.state)) {
    if (geo.stateSenateDistrict == null) issues.push('missing state senate district');
    if (geo.stateHouseDistrict == null) issues.push('missing state house district');
  }

  if (memberError) issues.push(memberError);

  return {
    ...row,
    ok: issues.length === 0,
    issues,
    geo,
    senators,
    house,
  };
}

export async function runQa({ log = console.log } = {}) {
  log('');
  log('Census address QA — live geocode of ' + ADDRESSES.length + ' addresses');
  log('(federal members from congress-legislators; state chamber numbers come from census)');
  log('');

  const results = [];
  for (const row of ADDRESSES) {
    process.stdout.write(`  … ${row.label}\r`);
    results.push(await checkOne(row));
  }
  process.stdout.write(' '.repeat(40) + '\r');

  for (const r of results) {
    const mark = r.ok ? 'OK' : '!!';
    log(`${mark}  ${r.label}`);
    log(`    asked:   ${r.address}`);
    if (!r.geo) {
      log(`    error:   ${r.error}`);
      log('');
      continue;
    }
    const g = r.geo;
    log(`    matched: ${g.matchedAddress}`);
    log(
      `    census:  state=${g.state}  CD=${fmtDistrict(g.congressionalDistrict)}` +
        `  senate=${fmtDistrict(g.stateSenateDistrict)}  house=${fmtDistrict(g.stateHouseDistrict)}` +
        `  county=${g.county || '—'} (${g.countyGeoid || '—'})`,
    );
    const fedNames = [...r.senators, ...r.house].map((m) => `${m.name} (${m.role})`).join('; ') || '—';
    log(`    federal: ${fedNames}`);
    if (r.issues?.length) log(`    issues:  ${r.issues.join('; ')}`);
    log('');
  }

  const failed = results.filter((r) => !r.ok);
  const withSenate = results.filter((r) => r.geo?.stateSenateDistrict != null).length;
  const withHouse = results.filter((r) => r.geo?.stateHouseDistrict != null).length;
  const withCd = results.filter((r) => r.geo?.congressionalDistrict != null).length;

  log('Summary');
  log(`  matched:              ${results.filter((r) => r.geo).length}/${results.length}`);
  log(`  with congressional:   ${withCd}/${results.length}`);
  log(`  with state senate:    ${withSenate}/${results.length}`);
  log(`  with state house:     ${withHouse}/${results.length}`);
  log(`  clean (no issues):    ${results.length - failed.length}/${results.length}`);
  if (failed.length) {
    log('');
    log('Needs a look:');
    for (const r of failed) log(`  - ${r.label}: ${(r.issues || [r.error]).join('; ')}`);
  }
  log('');

  return { results, failed };
}

const runningAsScript = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (runningAsScript) {
  const { failed } = await runQa();
  process.exit(failed.length ? 1 : 0);
}
