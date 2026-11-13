-- one row per roll call. the senate.gov list fills the summary, the vote file fills who voted.
create table if not exists senate_votes (
  congress int not null,
  session int not null,
  number int not null,
  vote_date timestamptz,
  question text,
  result text,
  bill text,
  title text,
  yeas int,
  nays int,
  -- what the senate.gov list says now
  list_mark text,
  -- what the list said when the vote file was downloaded. empty means not downloaded
  file_mark text,
  -- set while one visit is downloading this file
  claimed_at timestamptz,
  primary key (congress, session, number)
);

-- one row per senator per roll call
create table if not exists senate_positions (
  congress int not null,
  session int not null,
  number int not null,
  lis_id text not null,
  state text,
  last_name text,
  vote_cast text,
  primary key (congress, session, number, lis_id)
);

-- the feed asks for one state's senators
create index if not exists senate_positions_state on senate_positions (congress, session, state);

-- when the list was last downloaded
create table if not exists senate_sessions (
  congress int not null,
  session int not null,
  list_checked_at timestamptz,
  primary key (congress, session)
);
