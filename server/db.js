// Shared MongoDB Atlas connection (single client, reused across requests).
const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('FATAL: MONGODB_URI env var is not set.');
  process.exit(1);
}

// Database + collection names for this app (kept separate from Atlas sample data).
const DB_NAME = process.env.MONGODB_DB || 'phd';
const COLLECTIONS = {
  users: 'users',
  liveData: 'live_data',   // legacy single-doc store (kept for compatibility)
  quarters: 'quarters',    // per-quarter dataset docs: { _id: "2026-Q3", tickets: [...], meta: {...} }
  dataLog: 'data_log',     // audit log of uploads/publishes (who/when/what changed)
  blurbs: 'blurbs',        // common blurbs (title + text) shown on the Blurbs tool page
  blurbLog: 'blurb_log',   // audit log of blurb create/edit actions
  blurbCopies: 'blurb_copies', // per-user tally of blurb copies (user+blurbId -> count)
  hashtags: 'hashtags',    // hashtags (tag + description) shown on the Hashtags tool page
  hashtagLog: 'hashtag_log', // audit log of hashtag create/edit/delete actions
  hashtagCopies: 'hashtag_copies', // per-user tally of hashtag copies (user+hashtagId -> count)
  paging: 'paging',        // paging contacts (country + code + email)
  pagingLog: 'paging_log', // audit log of paging create/edit/delete actions
  pagingCopies: 'paging_copies', // per-user tally of paging-email copies (user+pagingId -> count)
  comments: 'comments',    // per-ticket comments (My Tickets)
  incidentLogs: 'incident_logs', // per-ticket incident logs (final mitigation + hashtags), My Tickets
  ticketActivity: 'ticket_activity', // per-ticket last app-activity (comment/log add/edit/delete) — our own reference, separate from CSV timestamps
  copyCountArchive: 'copy_count_archive', // stashed copy counts (+ per-user tallies) for deleted blurbs/hashtags/paging, so a delete+re-add restores the count
  importantCases: 'important_cases', // admin "mark important" notes + links per ticket (Unique Cases)
  importantCasesLog: 'important_cases_log', // audit log of mark/update actions on unique cases
  helpRequests: 'help_requests', // editor "ask for help" threads
  activityLog: 'activity_log', // account activity (e.g. password changes) — owner-visible, never stores secrets
  dashRollups: 'dash_rollups', // precomputed dashboard chunks per quarter { _id, publishedAt, chunks:{...} } — recomputed on each publish
  agentRollups: 'agent_rollups', // precomputed per-agent open-ticket summaries per quarter { _id, publishedAt, agents:{login:{statusCounts, openTix:[...]}} } — recomputed on each publish
  groupRollups: 'group_rollups', // precomputed Alpha/Gamma/Beta group metrics per quarter { _id, publishedAt, metrics:{...} } — recomputed on each publish
  shiftRollups: 'shift_rollups', // precomputed shift-report data per quarter { _id, publishedAt, openTix:[...], counts:{...} } — recomputed on each publish
  ticketDocs: 'ticket_docs', // ONE doc per ticket { _id: "<qid>|<ShortId>", q: qid, ShortId, ...all ticket fields } — lets publishes bulk-write only changed tickets instead of rewriting the whole ~6MB quarter doc
  ticketEvents: 'ticket_events', // ISOLATED live-movement log from LM-HUB: one doc per status change { shortId, status, at, ... }. Separate from ticket_docs — never affects the live dashboard.
  incidentGroups: 'incident_groups', // owner-defined display grouping of raw incident types (RootCause labels) into combined names. Applied at READ time to Incident Types; never changes ticket data. { _id:'live', version, groups:[{name, members:[rawType]}], updatedAt }
  resolutionGroups: 'resolution_groups', // owner-defined display grouping of raw Resolution values (from RootCauseDetails) into combined names. Owner-tool only for now. { _id:'live', version, groups:[{name, members:[rawValue]}], updatedAt }
};

let clientPromise = null;

function getClient() {
  if (!clientPromise) {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
    clientPromise = client.connect();
  }
  return clientPromise;
}

async function getDb() {
  const client = await getClient();
  return client.db(DB_NAME);
}

async function getCollection(name) {
  const db = await getDb();
  return db.collection(name);
}

module.exports = { getDb, getCollection, COLLECTIONS, DB_NAME };
