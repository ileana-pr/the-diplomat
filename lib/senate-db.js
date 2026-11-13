// where senate votes are remembered between visits.
// postgres when DATABASE_URL is set. memory otherwise, which lasts until the program stops.
import { neon } from '@neondatabase/serverless';

// a vote being downloaded is left alone by other visits for this long.
const CLAIM_MS = 2 * 60 * 1000;

// tests never touch the real database.
export function usingDatabase() {
  return Boolean(process.env.DATABASE_URL && !process.env.NODE_TEST_CONTEXT);
}

let store;
export function senateStore() {
  if (!store) store = usingDatabase() ? dbStore(neon(process.env.DATABASE_URL)) : memoryStore();
  return store;
}

export function resetSenateStore() {
  store = undefined;
}

function dbStore(sql) {
  return {
    async listCheckedAt(congress, session) {
      const rows = await sql`select list_checked_at from senate_sessions where congress = ${congress} and session = ${session}`;
      return rows[0]?.list_checked_at ? +new Date(rows[0].list_checked_at) : null;
    },

    // new roll calls are added. a known roll call only gets its new mark.
    async saveList(congress, session, rows, now) {
      await sql.transaction([
        sql`insert into senate_votes (congress, session, number, vote_date, question, result, bill, title, yeas, nays, list_mark)
            select ${congress}::int, ${session}::int, r.number, r.date, r.question, r.result, r.bill, r.title, r.yeas, r.nays, r.mark
            from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
              as r(number int, date timestamptz, question text, result text, bill text, title text, yeas int, nays int, mark text)
            on conflict (congress, session, number) do update set list_mark = excluded.list_mark
            where senate_votes.list_mark is distinct from excluded.list_mark`,
        sql`insert into senate_sessions (congress, session, list_checked_at)
            values (${congress}::int, ${session}::int, ${new Date(now)}::timestamptz)
            on conflict (congress, session) do update set list_checked_at = excluded.list_checked_at`,
      ]);
    },

    // roll calls whose file is missing or older than the list, and that nobody is downloading.
    async pending(congress, session, now) {
      const rows = await sql`select number, list_mark, file_mark from senate_votes
        where congress = ${congress} and session = ${session}
          and file_mark is distinct from list_mark
          and (claimed_at is null or claimed_at < ${new Date(now - CLAIM_MS)}::timestamptz)`;
      return rows.map((r) => ({ number: r.number, listMark: r.list_mark, fileMark: r.file_mark }));
    },

    // returns the numbers this visit may download. another visit asking at the same moment gets the rest.
    async claim(congress, session, numbers, now) {
      if (!numbers.length) return [];
      const rows = await sql`update senate_votes set claimed_at = ${new Date(now)}::timestamptz
        where congress = ${congress} and session = ${session} and number = any(${numbers}::int[])
          and file_mark is distinct from list_mark
          and (claimed_at is null or claimed_at < ${new Date(now - CLAIM_MS)}::timestamptz)
        returning number`;
      return rows.map((r) => r.number);
    },

    async saveVote(congress, session, vote, mark) {
      await sql.transaction([
        sql`insert into senate_votes (congress, session, number, vote_date, question, result, bill, title, yeas, nays, list_mark, file_mark)
            values (${congress}::int, ${session}::int, ${vote.number}::int, ${vote.date}::timestamptz, ${vote.question}, ${vote.result},
              ${vote.bill}, ${vote.title}, ${vote.yeas}::int, ${vote.nays}::int, ${mark}, ${mark})
            on conflict (congress, session, number) do update set
              vote_date = excluded.vote_date, question = excluded.question, result = excluded.result, bill = excluded.bill,
              title = excluded.title, yeas = excluded.yeas, nays = excluded.nays, file_mark = excluded.file_mark, claimed_at = null`,
        sql`delete from senate_positions where congress = ${congress} and session = ${session} and number = ${vote.number}`,
        sql`insert into senate_positions (congress, session, number, lis_id, state, last_name, vote_cast)
            select ${congress}::int, ${session}::int, ${vote.number}::int, m.lis, m.state, m."lastName", m."cast"
            from jsonb_to_recordset(${JSON.stringify(vote.members)}::jsonb) as m(lis text, state text, "lastName" text, "cast" text)
            on conflict do nothing`,
      ]);
    },

    async savedNumbers(congress, session) {
      const rows = await sql`select number from senate_votes
        where congress = ${congress} and session = ${session} and file_mark is not null`;
      return rows.map((r) => r.number);
    },

    // every downloaded roll call, with only this state's senators.
    async votesFor(congress, session, state) {
      const rows = await sql`select v.number, v.vote_date, v.question, v.result, v.bill, v.title, v.yeas, v.nays,
          coalesce(
            json_agg(json_build_object('lis', p.lis_id, 'state', p.state, 'lastName', p.last_name, 'cast', p.vote_cast))
              filter (where p.lis_id is not null),
            '[]'::json) as members
        from senate_votes v
        left join senate_positions p
          on p.congress = v.congress and p.session = v.session and p.number = v.number and p.state = ${state}
        where v.congress = ${congress} and v.session = ${session} and v.file_mark is not null
        group by v.congress, v.session, v.number
        order by v.number desc`;
      return rows.map((r) => ({
        number: r.number,
        date: r.vote_date ? new Date(r.vote_date).toISOString() : null,
        question: r.question,
        result: r.result,
        bill: r.bill,
        title: r.title,
        yeas: r.yeas,
        nays: r.nays,
        members: r.members,
      }));
    },
  };
}

// the same answers as the database, kept in this program's memory.
export function memoryStore() {
  const sessions = new Map();
  const at = (congress, session) => {
    const key = `${congress}-${session}`;
    if (!sessions.has(key)) sessions.set(key, { checkedAt: null, votes: new Map() });
    return sessions.get(key);
  };
  const open = (row, now) => row.fileMark !== row.listMark && !(row.claimedAt && now - row.claimedAt < CLAIM_MS);

  return {
    async listCheckedAt(congress, session) {
      return at(congress, session).checkedAt;
    },

    async saveList(congress, session, rows, now) {
      const s = at(congress, session);
      for (const r of rows) {
        const have = s.votes.get(r.number);
        if (have) have.listMark = r.mark;
        else s.votes.set(r.number, { ...r, listMark: r.mark, fileMark: null, claimedAt: null, members: [] });
      }
      s.checkedAt = now;
    },

    async pending(congress, session, now) {
      return [...at(congress, session).votes.values()]
        .filter((row) => open(row, now))
        .map((row) => ({ number: row.number, listMark: row.listMark, fileMark: row.fileMark }));
    },

    async claim(congress, session, numbers, now) {
      const { votes } = at(congress, session);
      const got = [];
      for (const n of numbers) {
        const row = votes.get(n);
        if (!row || !open(row, now)) continue;
        row.claimedAt = now;
        got.push(n);
      }
      return got;
    },

    async saveVote(congress, session, vote, mark) {
      const { votes } = at(congress, session);
      const have = votes.get(vote.number);
      votes.set(vote.number, { ...vote, listMark: have ? have.listMark : mark, fileMark: mark, claimedAt: null });
    },

    async savedNumbers(congress, session) {
      return [...at(congress, session).votes.values()].filter((row) => row.fileMark != null).map((row) => row.number);
    },

    async votesFor(congress, session, state) {
      return [...at(congress, session).votes.values()]
        .filter((row) => row.fileMark != null)
        .sort((a, b) => b.number - a.number)
        .map((row) => ({
          number: row.number,
          date: row.date,
          question: row.question,
          result: row.result,
          bill: row.bill,
          title: row.title,
          yeas: row.yeas,
          nays: row.nays,
          members: row.members.filter((m) => m.state === state),
        }));
    },
  };
}
