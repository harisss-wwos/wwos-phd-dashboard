// Seed the initial Common Blurbs into Atlas. Idempotent: skips blurbs whose title already exists.
require('dotenv').config();
const { getCollection, COLLECTIONS } = require('./db');

const BLURBS = [
  {
    title: 'Out of Scope (GSOC Tickets)',
    text: `The PHD team has reviewed the incident reported and determined that this issue falls outside GSOC's LMET scope. This SIM will be resolved as a result. Should additional information emerge that materially affects the disposition of this incident, please create a new ticket for review. If you believe this determination is incorrect or clarification on PHD scope is needed, send inquiries to phd-emt-intake@amazon.com.
#out-of-scope`,
  },
  {
    title: 'No EMT',
    text: `In order to make a determination, this incident needs to be reported though the GSOC's LMET Team.
To ensure all necessary details of this incident are captured, please create or attach the corresponding EMT report to the Overview section of this ticket.
#no-emt-attached`,
  },
  {
    title: 'Exclusion Denial',
    text: `The PHD Team has completed its review of the exclusion request. Based on our assessment, we have determined that alternative mitigation measures are more appropriate at this time and will be implemented to address the identified concerns.
We encourage continued reporting of any future incidents through established channels. The PHD team will monitor the situation and conduct reassessments as needed to ensure transporter safety remains our priority.`,
  },
  {
    title: 'Exclusion Request',
    text: `Exclusion requested in: [URL Link to SIM]
or
Deprioritization requested in: [URL Link to SIM]
Once exclusion is deployed, removed account hold.

Example: "Exclusion requested in: https://issues.amazon.com/issues/V2164067046 @smeadors Once exclusion is deployed, removed account hold."`,
  },
  {
    title: 'API',
    text: `This EMT was submitted through digital intake and may not contain the level of detail necessary for an accurate scope determination. Conduct Driver outreach to confirm incident specifics and ensure all relevant facts are captured prior to final determination. Please process the EMT accordingly. Thank you for your collaboration.`,
  },
  {
    title: 'Parcel Box',
    text: `The customer has accepted the installation of a Parcel Box. The PHD team will resolve this investigation accordingly and continue to monitor for successful Parcel Box installation, as well as confirmation that any associated GeoPin updates have been completed.

To complete the parcel box setup, we require the following from the customer (CX):

1. Confirmation of Receipt & Installation – Written acknowledgment that the parcel box has been received, properly installed, and positioned near the roadside for driver accessibility.
2. Photo Documentation – Clear photographs showing:
   - The installed parcel box in its final location.
   - Proximity to the road/curb for driver visibility.
3. Geopin Update – An updated geopin reflecting the exact installation location of the parcel box.
4. Updated Delivery Instructions – Revised delivery instructions specifying that packages should be delivered to the parcel box. Please include:
   - The color of the parcel box for easy driver identification.
   - Any additional landmarks or identifiers to assist with locating the box.
These steps ensure our drivers can quickly and accurately identify and deliver to the parcel box on future routes.`,
  },
  {
    title: 'India Impeding Egress',
    text: `This incident has been identified as a regional recurrence.
A life safety assessment has been completed and no life safety concerns have been identified at this time.
No further action is required at this time.`,
  },
  {
    title: 'First Time Pet Incidents',
    text: `No further action is required by the PHD Team at this time. This incident falls under one or more of the following categories:

First-time pet incident
The driver did not sustain significant injuries
The driver is not seeking immediate medical attention
The dog belongs to a community member (CM) and not the customer (CX)
The animal/pet did not make contact with the driver

Should additional information emerge that materially affects the disposition of this incident, PHD will conduct a reassessment.
#out-of-scope`,
  },
  {
    title: 'Paw Print Notification',
    text: `To support future driver safety and awareness, please ensure a Paw Print notification is in place for this address and provide the associated link for confirmation.`,
  },
  {
    title: 'Unidentifiable POI',
    text: `This incident pertains to a Community Member (CM) and does not involve the Customer (CX). The Person of Interest (POI) cannot be identified based on the information currently available. The PHD team will resolve this case accordingly.
Should additional information become available that aids in identifying the POI, please update the ticket. The SIM will be reopened as necessary to facilitate any required support or mitigation efforts.`,
  },
  {
    title: 'API-EMT Created but not disseminated',
    text: `An EMT has been created via the API but has not yet been reviewed, assessed, or disseminated by LMET. The EMT has been resubmitted to GSOC. Please allow adequate processing time for it to be properly documented and disseminated.
#api-emt-miss`,
  },
  {
    title: 'Closing Blurb',
    text: `Following a comprehensive review of all available evidence, the Potential Harm to Driver (PHD) team has completed its assessment and investigation of this case in accordance with established protocols. Appropriate mitigation measures have been implemented in alignment with the findings. Accordingly, this matter is now considered resolved, and no further action is required by the PHD team at this time.`,
  },
];

(async () => {
  const coll = await getCollection(COLLECTIONS.blurbs);
  const now = new Date().toISOString();
  let created = 0, skipped = 0, order = 0;
  for (const b of BLURBS) {
    order++;
    const existing = await coll.findOne({ title: b.title });
    if (existing) { console.log('skip (exists):', b.title); skipped++; continue; }
    await coll.insertOne({ title: b.title, text: b.text, createdBy: 'seed', createdAt: now, updatedBy: 'seed', updatedAt: now, order });
    console.log('created:', b.title);
    created++;
  }
  console.log(`\nBlurb seed complete. created=${created}, skipped=${skipped}`);
  process.exit(0);
})().catch(e => { console.error('Blurb seed failed:', e.message); process.exit(1); });
