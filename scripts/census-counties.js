// fills geoid, name, and state in data/counties.json from the census county file.
// run: npm run census
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const rawZip = path.join(root, 'data', 'raw', '2025_Gaz_counties_national.zip');
const outFile = path.join(root, 'data', 'counties.json');
// the 2025 national file already includes puerto rico's 78 municipios. island areas are not in it.
const CENSUS_URL = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_counties_national.zip';

// census returns 403 unless the request names a browser-like user agent.
const USER_AGENT = 'Mozilla/5.0 (compatible; TheDiplomat/0.1; personal civic feed)';

export function parseGazetteer(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) throw new Error('Census county file is empty.');
  const delimiter = lines[0].includes('|') ? '|' : '\t';
  const header = lines[0].split(delimiter);
  const stateCol = header.indexOf('USPS');
  const geoidCol = header.indexOf('GEOID');
  const nameCol = header.indexOf('NAME');
  if (stateCol < 0 || geoidCol < 0 || nameCol < 0) {
    throw new Error('Census county file is missing USPS, GEOID, or NAME.');
  }
  const rows = [];
  const seen = new Set();
  for (const line of lines.slice(1)) {
    const cols = line.split(delimiter);
    const geoid = cols[geoidCol];
    const state = cols[stateCol];
    const name = cols[nameCol];
    if (!/^\d{5}$/.test(geoid)) throw new Error(`Bad GEOID: ${geoid}`);
    if (!/^[A-Z]{2}$/.test(state)) throw new Error(`Bad state for ${geoid}: ${state}`);
    if (!name) throw new Error(`Missing name for ${geoid}`);
    if (seen.has(geoid)) throw new Error(`Duplicate GEOID ${geoid}`);
    seen.add(geoid);
    rows.push({ geoid, name, state });
  }
  return rows;
}

// a short download must not replace the list. 3,000 is below the real count (3,222 in 2025).
export function assertComplete(rows) {
  const puertoRico = rows.filter((row) => row.state === 'PR').length;
  if (rows.length < 3000 || puertoRico < 70) {
    throw new Error(`Census file looks incomplete (${rows.length} counties, ${puertoRico} Puerto Rico municipios). The county list was not changed.`);
  }
}

// census owns geoid, name, and state. a website or member list already stored on that county stays.
// a county that left the census file is dropped, because this script owns the set of counties.
export function mergeCounties(existing, rows) {
  const next = {};
  for (const row of rows) {
    const prev = existing?.[row.geoid] && typeof existing[row.geoid] === 'object' ? existing[row.geoid] : {};
    const { geoid, name, state, ...rest } = prev;
    next[row.geoid] = { geoid: row.geoid, name: row.name, state: row.state, ...rest };
  }
  return next;
}

async function download(url, dest) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Census download failed (${res.status}) for ${url}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

function readZipText(zipPath) {
  try {
    return execFileSync('unzip', ['-p', zipPath], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  } catch (err) {
    throw new Error(`Could not read the Census zip. unzip is required. ${err.message}`);
  }
}

function writeCounties(file, records) {
  // write the text ourselves. json.stringify would put 10001 before 01001.
  const lines = Object.keys(records).sort().map((geoid) => {
    const body = JSON.stringify(records[geoid], null, 2).replace(/\n/g, '\n  ');
    return `  ${JSON.stringify(geoid)}: ${body}`;
  });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `{\n${lines.join(',\n')}\n}\n`);
}

export async function main() {
  await download(CENSUS_URL, rawZip);
  const rows = parseGazetteer(readZipText(rawZip));
  assertComplete(rows);
  const existing = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : {};
  const merged = mergeCounties(existing, rows);
  writeCounties(outFile, merged);
  const puertoRico = rows.filter((row) => row.state === 'PR').length;
  console.log(`Wrote ${Object.keys(merged).length} counties (${puertoRico} Puerto Rico municipios) to data/counties.json`);
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
