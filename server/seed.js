// Seed the initial accounts. Idempotent: skips users that already exist.
// Passwords are read from env (SEED_*_PW) if provided, else fall back to the initial
// setup passwords. All are stored bcrypt-hashed — raw values are never written to the DB.
require('dotenv').config();
const { getCollection, COLLECTIONS } = require('./db');
const { hashPassword } = require('./auth');

const SEED_USERS = [
  { username: 'harisss',  role: 'owner', pw: process.env.SEED_HARISSS_PW  || 'harisss@123'  },
  { username: 'arunkzn',  role: 'admin', pw: process.env.SEED_ARUNKZN_PW  || 'arunkzn@123'  },
  { username: 'flofalgu', role: 'admin', pw: process.env.SEED_FLOFALGU_PW || 'flofalgu@123' },
  { username: 'punithsd', role: 'admin', pw: process.env.SEED_PUNITHSD_PW || 'punithsd@123' },
];

(async () => {
  const users = await getCollection(COLLECTIONS.users);
  await users.createIndex({ username: 1 }, { unique: true });
  let created = 0, skipped = 0;
  for (const u of SEED_USERS) {
    const username = u.username.toLowerCase();
    const existing = await users.findOne({ username });
    if (existing) { console.log('skip (exists):', username, '(' + existing.role + ')'); skipped++; continue; }
    await users.insertOne({
      username,
      passwordHash: await hashPassword(u.pw),
      role: u.role,
      createdAt: new Date(),
    });
    console.log('created:', username, '->', u.role);
    created++;
  }
  console.log(`\nSeed complete. created=${created}, skipped=${skipped}`);
  process.exit(0);
})().catch(e => { console.error('Seed failed:', e.message); process.exit(1); });
