// Seed the initial Paging contacts into Atlas. Idempotent: skips codes that already exist.
require('dotenv').config();
const { getCollection, COLLECTIONS } = require('./db');

const CONTACTS = [
  { country: 'United States',  code: 'US', email: 'sds-ecr-adhoc@amazon.com' },
  { country: 'Canada',         code: 'CA', email: 'sds-ecr-adhoc@amazon.ca' },
  { country: 'Mexico',         code: 'MX', email: 'sds-ecr-adhoc@amazon.com.mx' },
  { country: 'Germany',        code: 'DE', email: 'sds-ecr-adhoc@amazon.de' },
  { country: 'United Kingdom', code: 'UK', email: 'sds-ecr-adhoc@amazon.co.uk' },
  { country: 'Spain',          code: 'ES', email: 'sds-ecr-adhoc@amazon.es' },
  { country: 'France',         code: 'FR', email: 'sds-ecr-adhoc@amazon.fr' },
  { country: 'Italy',          code: 'IT', email: 'sds-ecr-adhoc@amazon.it' },
  { country: 'Australia',      code: 'AU', email: 'sds-ecr-adhoc@amazon.com.au' },
  { country: 'Japan',          code: 'JP', email: 'sds-ecr-incident-support@amazon.co.jp' },
  { country: 'Singapore',      code: 'SG', email: 'sds-ecr-adhoc@amazon.sg' },
  { country: 'Netherlands',    code: 'NL', email: 'sds-ecr-adhoc@amazon.nl' },
  { country: 'India',          code: 'IN', email: 'sds-ecr-adhoc@amazon.in' },
];

(async () => {
  const coll = await getCollection(COLLECTIONS.paging);
  const now = new Date().toISOString();
  let created = 0, skipped = 0, order = 0;
  for (const c of CONTACTS) {
    order++;
    const existing = await coll.findOne({ code: c.code });
    if (existing) { console.log('skip (exists):', c.code); skipped++; continue; }
    await coll.insertOne({ country: c.country, code: c.code, email: c.email, createdBy: 'seed', createdAt: now, order });
    console.log('created:', c.code, '-', c.country);
    created++;
  }
  console.log(`\nPaging seed complete. created=${created}, skipped=${skipped}`);
  process.exit(0);
})().catch(e => { console.error('Paging seed failed:', e.message); process.exit(1); });
