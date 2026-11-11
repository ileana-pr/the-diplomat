# Data flow and file structure

The app loads one county list. Scripts add to that list over time. A person does not keep a second, preferred copy of any county.

This document describes that design. The Census script is built. The running app reads `data/counties.json`. Later scripts (websites, meeting feeds, board members) are not built yet.

## What a request does today

A visitor enters a street address. `server.js` calls `buildFeed` in `lib/feed.js`, which collects three levels of government and returns one feed, newest first.

```
address
  └─ Census geocoder (lib/geo.js)
       ├─ state + congressional district → Congress members, votes, bills (lib/federal.js)
       ├─ latitude/longitude + state     → state legislators, bills, votes (lib/state.js)
       └─ county GEOID                   → county record (lib/county.js)
```

A GEOID is the Census id for a county: two digits for the state and three for the county. Orange County, Virginia is `51137` (Virginia is `51`, Orange County is `137`). The geocoder already returns this id for any matched address. The county step is the only one that depends on a local list.

`lib/county.js` looks the GEOID up in `data/counties.json`. If the id is missing, the feed says the county is not in the list. If the id is present, the app shows the county name. It reads board members from `members`, and agenda and news items from the feed URLs, only when those fields are filled.

## The county list

The Census Bureau's 2025 national county file has 3,222 counties and county-equivalents. That is the 3,144 in the 50 states and the District of Columbia, plus Puerto Rico's 78 municipios. The stateside count includes Louisiana parishes, Alaska boroughs and census areas, independent cities, and Connecticut's 9 planning regions. The geocoder's current vintage uses those same ids, including Connecticut regions `09110` through `09190`. Puerto Rico ids start with `72`, such as `72001` for Adjuntas. The smaller island areas are not in this file.

Every county is one record in one file, `data/counties.json`, keyed by GEOID. The app reads that file and no other county file. Orange County is one GEOID in the list, the same as every other county. A filled sample of that record lives in `test/fixtures/counties.json` and is used only by `test/feed.test.js`. It is not a special live county and it is not an override.

A blank field means no script has found that fact yet. The feed shows the county name from the Census fields. It shows agendas, news, or members only when those fields are filled.

## How scripts fill the list

Each script knows one kind of fact. It opens `data/counties.json`, finds each county by GEOID, writes only the fields it owns, and saves the file. Other fields stay as they are.

The Census script has to run first, because it creates the records. Run it with `npm run census`. It downloads the 2025 national county file into `data/raw/` and writes `data/counties.json`. After that, scripts can run in any order. A later script does not invent a county the Census script has not created. A county that is no longer in the Census file is dropped on the next census run. Fields another script already stored on a county that is still in the file stay put.

A script writes a field only when it has a new value. If a lookup fails, the stored value stays. Re-running the Census script refreshes names and states. It does not clear websites or feed URLs that another script already stored.

Each field has one owner, so two scripts cannot overwrite the same fact.

| Field | Owner | What it is |
| --- | --- | --- |
| `geoid`, `name`, `state` | Census script | Identity from the Census county file. |
| `website` | Website script | Official county website, where a source such as Wikidata has one. |
| `agendaRss`, `newsRss` | CivicPlus script | Feed URLs on sites that use CivicPlus the way Orange County does. |
| `members` | A later officials script | Current board members. Empty until a source exists. |

More facts can be added the same way. A new source gets a new script and, if needed, a new field. The CivicPlus script is the pattern for the next vendor script (Granicus, BoardDocs, CivicClerk, and others): match the site, write that vendor's URLs, leave every other field alone.

These fields already exist on the hand-written sample and are not owned yet. A future script can take each one.

| Field | Used for |
| --- | --- |
| `body` | Board name, such as Board of Supervisors or County Commission. |
| `boardPage`, `agendasPage` | Links shown with the county. |
| `agendaCenter` | Fallback page when `agendaRss` has no items. |
| `newsPage` | Human page for county news. The feed itself reads `newsRss`. |
| `districtMap` | Present on the sample record. No screen reads it yet. |

`members` is a list. Each person has `name`, `district`, `url`, and sometimes `title`. `lib/county.js` skips members, agendas, and news when those fields are blank. The page still shows the county name.

## Where files live

```
the-diplomat/
  server.js                 # HTTP server. One route, /api/feed, builds the feed.
  public/                   # The page the browser loads.
  scripts/census-counties.js  # Downloads the Census county file and fills geoid, name, and state.
  lib/                      # Feed building. geo.js, federal.js, state.js, county.js.
  test/                     # Sample responses, including an Orange County address.
    fixtures/counties.json  # One filled Orange County record, used only by tests.
  docs/data-flow.md         # This document.

  data/
    counties.json           # The one county list the app loads. Committed on purpose (see below).
    raw/                    # Downloads the scripts read. Safe to delete and fetch again.
      2025_Gaz_counties_national.zip  # Census script input.
    http/                   # Saved copies of pages the app has already fetched.
```

`data/*` is listed in `.gitignore` because `data/http` is a cache this machine can rebuild. `data/counties.json` is the exception: filling websites and feeds means visiting thousands of counties, so the list is committed. `data/raw/` stays ignored.

Scripts read `data/raw/` and write `data/counties.json`. The running app reads `data/counties.json` and never reads `data/raw/`.
