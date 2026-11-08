# Data flow and file structure

The app loads one county list. Scripts add to that list over time. A person does not keep a second, preferred copy of any county.

This document describes that design. The scripts and the shared list are not built yet. Until they are, the running app still reads the single hand-written entry in `config/counties.js`.

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

`lib/county.js` looks the GEOID up in `config/counties.js`. If the id is missing, the feed says the county is not set up. If the id is present, the app reads board members from `members` and agenda and news items from the feed URLs on that same record.

## The county list

There are 3,144 counties and county-equivalents in the 50 states and the District of Columbia (Census Bureau, 2025). That includes Louisiana parishes, Alaska boroughs and census areas, independent cities, and Connecticut's 9 planning regions. The geocoder's current vintage uses those same ids, including Connecticut regions `09110` through `09190`. Territories are not part of this list.

Every county is one record in one file, `data/counties.json`, keyed by GEOID. The app will read that file and no other county file. Orange County is one GEOID in the list, the same as every other county. Its current hand-written entry is a sample of a filled record and the fixture used by `test/feed.test.js`. It is not a special live county and it is not an override.

A blank field means no script has found that fact yet. The feed shows the county name from the Census fields. It shows agendas, news, or members only when those fields are filled.

## How scripts fill the list

Each script knows one kind of fact. It opens `data/counties.json`, finds each county by GEOID, writes only the fields it owns, and saves the file. Other fields stay as they are.

The Census script has to run first, once, because it creates the 3,144 records. After that, scripts can run in any order. A later script does not invent a county the Census script has not created.

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

`members` is a list. Each person has `name`, `district`, `url`, and sometimes `title`. `lib/county.js` still assumes `members` is always present. When the app switches to `data/counties.json`, that code has to skip members, agendas, and news when those fields are blank.

## Where files live

```
the-diplomat/
  server.js                 # HTTP server. One route, /api/feed, builds the feed.
  public/                   # The page the browser loads.
  lib/                      # Feed building. geo.js, federal.js, state.js, county.js.
  config/counties.js        # Today's only county record. Goes away once the app reads data/counties.json.
  test/                     # Sample responses, including an Orange County address.
  docs/data-flow.md         # This document.

  data/                     # Gitignored. Created on this machine, not committed.
    counties.json           # The one county list the app will load. Committed on purpose (see below).
    raw/                    # Downloads the scripts read. Safe to delete and fetch again.
      census-counties.*     # Census script input.
    http/                   # Saved copies of pages the app has already fetched.
    senate/                 # Senate roll-call XML, refreshed about once an hour.
```

`data/` is listed in `.gitignore` because `data/http` and `data/senate` are caches this machine can rebuild. `data/counties.json` is different: filling websites and feeds means visiting thousands of counties, so the finished list should be committed. When the file is added, `.gitignore` needs an exception for that file only. `data/raw/` stays ignored.

Scripts read `data/raw/` and write `data/counties.json`. The running app reads `data/counties.json` and never reads `data/raw/`.
