# The Diplomat

A personal civic feed. Enter your home address and see your county supervisors, state legislators and members of Congress, how they voted, what they sponsored, and what's on your county board's agenda, newest first.

## Run it

You need [Node.js](https://nodejs.org/) 20 or newer. There's nothing to install beyond that.

```
cd the-diplomat
copy .env.example .env      (Windows)   or   cp .env.example .env   (Mac/Linux)
npm start
```

Then open http://localhost:3000 and enter your address.

## API keys (both free)

Put them in `.env`. The site runs without them, with less data.

| Key | What it unlocks | Sign up |
| --- | --- | --- |
| `CONGRESS_API_KEY` | Federal bills your members sponsored and co-sponsored. Without it, the shared `DEMO_KEY` is used, which allows only a few requests an hour. | https://api.congress.gov/sign-up/ |
| `OPENSTATES_API_KEY` | Your state senator and delegate by name, their bills, and their floor votes. | https://open.pluralpolicy.com/accounts/signup/ |

## Where the data comes from

| Feed section | Source |
| --- | --- |
| Your districts | U.S. Census geocoder (address to congressional, state senate, state house, county) |
| Who your members of Congress are | [unitedstates/congress-legislators](https://github.com/unitedstates/congress-legislators) |
| House votes | Office of the Clerk roll-call XML (latest 20 votes). The yearly index page no longer loads, so the app finds the newest roll-call file directly. |
| Senate votes | Senate.gov roll-call XML for the whole session, saved in `data/senate`. About once an hour, an off-screen Chrome window reads the vote list and downloads a vote file only when it is new or its result or tally changed, a few files at a time. The feed reads those files. If Chrome cannot read the site, a public copy from [Voteview](https://voteview.com/) is used until the files are ready. |
| Federal bills | Congress.gov API |
| Virginia General Assembly | Open States / Plural API |
| Orange County Board of Supervisors | County Agenda Center and News Flash (CivicPlus) |
| Background research links | Wikipedia, Ballotpedia, OpenSecrets, FEC, GovTrack, Vote Smart, VPAP, news search |

## Adding counties

County records live in one list, `data/counties.json`. `npm run census` downloads the Census Bureau county file and fills the name and state for every county, including Puerto Rico's municipios. Other fields stay blank until a later script finds them. The file layout and the rules are in [docs/data-flow.md](docs/data-flow.md).

## Tests

`npm test` runs the feed builder against sample responses shaped like each real service.

## Known limits of this first version

- Orange County supervisors are listed as a whole board. The site doesn't yet work out which supervisor district your address is in.
- House votes are the latest 20 roll calls. Senate votes grow toward every roll call in the current session. The feed shows 30 cards at a time.
- Senate votes need Google Chrome installed. The server opens it off-screen about once an hour, reads the vote list, and downloads only new or changed vote files. Until the first save finishes, the feed uses Voteview.
- Data is cached in memory for 10 to 60 minutes. Restart the server to refresh right away.
