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
  hashtags: 'hashtags',    // hashtags (tag + description) shown on the Hashtags tool page
  hashtagLog: 'hashtag_log', // audit log of hashtag create/edit/delete actions
  paging: 'paging',        // paging contacts (country + code + email)
  comments: 'comments',    // per-ticket comments (My Tickets)
  helpRequests: 'help_requests', // editor "ask for help" threads
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
