// Seed the initial Hashtags into Atlas. Idempotent: skips tags that already exist.
require('dotenv').config();
const { getCollection, COLLECTIONS } = require('./db');

const HASHTAGS = [
  { tag: 'out-of-scope', desc: 'No further action required by PHD Team due to the incident being outside PHD purview' },
  { tag: 'duplicate-report', desc: 'When you find duplicate PHD SIM of an incident for which there is an original PHD SIM already existing' },
  { tag: 'language-barrier', desc: 'Root cause of escalation likely involves a language barrier (ex. did not follow delivery instructions, Driver report is made in non-english language)' },
  { tag: 'incorrect-geopin', desc: 'Incidents where the Geopin was incorrect and attributed to the root cause for the escalation' },
  { tag: 'da-misconduct', desc: 'The Root cause is found to be a driver false report/misconduct related' },
  { tag: 'dp-misconduct', desc: 'The Root cause is found to be a driver false report/misconduct related' },
  { tag: 'hubda-misconduct', desc: 'The Root cause is found to be a driver false report/misconduct related' },
  { tag: 'contradictory-statement-no-proof', desc: 'Contradictory statements made by CX and DA/DP, no proof to determine the truth' },
  { tag: 'unsucessful-outreach', desc: 'Extensive outreach has been attempted on CX with no response' },
  { tag: 'cx-verification-rejection', desc: 'CX is unwilling or unable to authenticate their account with LMIR/SDS, often due to the belief of the agent being a scammer' },
  { tag: 'no-emt-attached', desc: 'Incidents that have been submitted into LM-HUB without an EMT attached' },
  { tag: 'no-phd-created', desc: 'Incidents that are missing a PHD SIM but are in-scope (LMIR SIM, and EMT present)' },
  { tag: 'api-emt-miss', desc: 'An API EMT is identified unsubmitted to LMET/GSOC' },
  { tag: 'emt-defect', desc: 'Instances where the EMT is provided by LMET with inadequate details, or incorrect data (example: API reports with no Driver outreach)' },
  { tag: 'appeal-review', desc: 'Customer is requesting an appeal be made to a mitigation action on their account/address' },
  { tag: 'missing-auto-comms', desc: 'Used to track inconsistencies in LMIR/PHD SIM tickets, if data/attachments/outreach is missing from one SIM add this hashtag' },
  { tag: 'support-f-r', desc: 'Applicable when a support team states that an action was taken but was either incorrectly actioned or not at all.' },
  { tag: 'support-p-b', desc: 'Applicable when a support team refuses or refutes a request/determination made by a PHD Agent' },
  { tag: 'address-employee', desc: 'When the incident involves Security/ Property Management/ Receptionist as the POI/Victim' },
];

(async () => {
  const coll = await getCollection(COLLECTIONS.hashtags);
  const now = new Date().toISOString();
  let created = 0, skipped = 0, order = 0;
  for (const h of HASHTAGS) {
    order++;
    const existing = await coll.findOne({ tag: h.tag });
    if (existing) { console.log('skip (exists):', h.tag); skipped++; continue; }
    await coll.insertOne({ tag: h.tag, desc: h.desc, createdBy: 'seed', createdAt: now, updatedBy: 'seed', updatedAt: now, order });
    console.log('created:', h.tag);
    created++;
  }
  console.log(`\nHashtag seed complete. created=${created}, skipped=${skipped}`);
  process.exit(0);
})().catch(e => { console.error('Hashtag seed failed:', e.message); process.exit(1); });
