// One-time backfill: set per-user access flags (badge / analyst / canUpload / canCreateUsers / canDatabase)
// on the existing accounts, and create the new accounts, per the owner's spec.
// canDatabase defaults to false for everyone here (owner always has it via force-true at read time);
// grant it per-user from the Users page "Database page" toggle. Set canDatabase:true below to seed it.
// Idempotent: updates flags on existing users; creates missing users with pw "<username>@123".
// Run once:  node server/backfill-user-flags.js
require('dotenv').config();
const { getCollection, COLLECTIONS } = require('./db');
const { hashPassword } = require('./auth');

// badge: 'blue' | 'yellow'; analyst / canUpload / canCreateUsers: booleans.
const SPEC = [
  { username: 'ashamzon', badge: 'blue',   analyst: false, canUpload: true,  canCreateUsers: false },
  { username: 'wehnermi', badge: 'blue',   analyst: false, canUpload: true,  canCreateUsers: false },
  { username: 'arunkzn',  badge: 'blue',   analyst: true,  canUpload: true,  canCreateUsers: true  },
  { username: 'flofalgu', badge: 'blue',   analyst: true,  canUpload: true,  canCreateUsers: true  },
  { username: 'punithsd', badge: 'blue',   analyst: true,  canUpload: true,  canCreateUsers: true  },
  { username: 'mbozied',  badge: 'blue',   analyst: true,  canUpload: true,  canCreateUsers: true  },
  { username: 'mellanej', badge: 'blue',   analyst: true,  canUpload: true,  canCreateUsers: true  },
  { username: 'nobregak', badge: 'blue',   analyst: true,  canUpload: true,  canCreateUsers: true  },
  { username: 'anagdeve', badge: 'blue',   analyst: false, canUpload: false, canCreateUsers: false },
  { username: 'partaim',  badge: 'blue',   analyst: false, canUpload: false, canCreateUsers: false },
  { username: 'sinsoum',  badge: 'blue',   analyst: false, canUpload: false, canCreateUsers: false },
  { username: 'chousoud', badge: 'yellow', analyst: true,  canUpload: false, canCreateUsers: false },
  { username: 'dbiswamb', badge: 'yellow', analyst: true,  canUpload: false, canCreateUsers: false },
  { username: 'obalasut', badge: 'yellow', analyst: true,  canUpload: false, canCreateUsers: false },
  { username: 'shaavhad', badge: 'yellow', analyst: true,  canUpload: false, canCreateUsers: false },
  { username: 'tanviroo', badge: 'yellow', analyst: true,  canUpload: false, canCreateUsers: false },
  { username: 'urmahala', badge: 'yellow', analyst: true,  canUpload: false, canCreateUsers: false },
];

(async () => {
  const users = await getCollection(COLLECTIONS.users);
  let updated = 0, created = 0;
  for (const s of SPEC) {
    const username = s.username.toLowerCase();
    const flags = { badge: s.badge, analyst: !!s.analyst, canUpload: !!s.canUpload, canCreateUsers: !!s.canCreateUsers, canDatabase: !!s.canDatabase, updatedAt: new Date() };
    const existing = await users.findOne({ username });
    if (existing) {
      // Never touch the owner's role; just set flags. (Owner is force-full-access at read time anyway.)
      await users.updateOne({ _id: existing._id }, { $set: flags });
      console.log('updated flags:', username, JSON.stringify(s));
      updated++;
    } else {
      const doc = Object.assign(
        { username, passwordHash: await hashPassword(username + '@123'), role: 'user', timezone: 'IST', createdAt: new Date() },
        { badge: s.badge, analyst: !!s.analyst, canUpload: !!s.canUpload, canCreateUsers: !!s.canCreateUsers, canDatabase: !!s.canDatabase }
      );
      await users.insertOne(doc);
      console.log('created:', username, '(pw ' + username + '@123)', JSON.stringify(s));
      created++;
    }
  }
  console.log(`\nBackfill complete. updated=${updated}, created=${created}`);
  process.exit(0);
})().catch(e => { console.error('Backfill failed:', e.message); process.exit(1); });
