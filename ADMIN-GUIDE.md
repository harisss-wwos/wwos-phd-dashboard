# WWOS-GSOC PHD Dashboard — Admin & Operations Guide

A practical guide for the people who run the PHD ticket-analytics dashboard. Share this with your peers.

- **Live site:** https://harisss-wwos.github.io/wwos-phd-dashboard/
- **Who this is for:** Admins, Managers, and the Owner (the people who log in, upload data, and answer help requests). Contractors (called *editors* in the system) have a separate, smaller section at the end.

---

## 1. Roles at a glance

| Role | Can view dashboard | Upload / publish data | Answer help requests | Manage users |
|------|:---:|:---:|:---:|:---:|
| **Owner** | Yes | Yes | Yes | Yes |
| **Manager** | Yes | Yes | Yes | No |
| **Admin** | Yes | Yes | Yes | No |
| **Editor** (contractor) | Yes | No | No (they *ask*) | No |
| **Anyone (not logged in)** | Summary only | No | No | No |

Notes:
- **Viewing the dashboard needs no login.** Anyone can see the charts and summary tables.
- **Ticket-level detail** (clicking a color tile, an incident type, or a historical-incident row to see per-agent tickets) is **logged-in only**. Logged-out visitors are shown a "Login required" prompt.
- **Groups, Previous Week, and Shift Report** buttons only appear for logged-in users.
- Only the **Owner** can add, edit, or remove user accounts.

---

## 2. First login — and change your password right away

1. Go to the live dashboard and click **Login** (top-right).
2. Enter the **username** and **temporary password** the Owner gave you.
3. You'll see your name and role appear in the toolbar.

**Change your password immediately after your first login:**

1. Click your **avatar** (top-right) to open your **Profile** page.
2. Under **Security**, click **Change Password**.
3. Enter your **current password**, then your **new password** (minimum 6 characters) twice.
4. Click **Update Password**.

> Treat the temporary password as one-time. Do not share accounts — each person should log in as themselves so the data log and help threads attribute actions correctly.

### While you're on the Profile page
- Set a **display name** and optionally upload a **profile photo** (avatar). These are visible to other users across the dashboard (in agent lists, help threads, etc.).
- Your **login ID** and **role** are read-only — only the Owner can change a role.

---

## 3. Uploading data (Admin / Manager / Owner)

Data is uploaded as a **CSV export of PHD tickets**. When you upload, the file is **merged** into the current quarter's dataset and **published to everyone** automatically (it becomes the live data for all viewers).

### How to upload
1. Log in.
2. On the live dashboard, click **Upload new data** (green button, top-right).
3. Pick your CSV file. The dashboard processes it, merges it with existing tickets, and publishes.
4. When done, an **Upload Complete** summary appears showing what changed (added / updated / reopened / auto-closed / unchanged).

### What "merge" does
- **New tickets** are added.
- **Existing tickets** are updated when their status has advanced (e.g. Assigned → Resolved).
- **Reopened tickets** (was Resolved/Closed, now Work In Progress again) are flagged and shown as **PURPLE** on the dashboard.
- **Missing tickets** that were previously Resolved are treated as auto-closed.
- The whole change set is recorded in the **Update data log** (see section 5).

### Quarters
The dashboard is organized by **quarter** (e.g. Q3 2026). The **live quarter** is the current quarter based on today's date. If your upload contains tickets that belong to a **different quarter**, the dashboard will flag it and ask you to review before overwriting that other quarter's data. This prevents accidentally mixing quarters.

---

## 4. CSV fields — what the upload needs

Each row is one ticket. The parser keys off column **headers**, so header names must match. A ticket row is only kept if it has a **ShortId** (or IssueId, which is treated as the ShortId).

### Required / most important fields
| Field | Why it matters |
|-------|----------------|
| **ShortId** (or IssueId) | Unique ticket ID. Rows without it are skipped. Used as the merge key. |
| **CreateDate** | Ticket creation time. Drives ticket age, the 240-hour (10-day) deadline, weekly/daily created charts, and SLA timing. |
| **Status** | e.g. `Assigned`, `Work In Progress`, `Pending`, `Researching`, `Resolved`, `Closed`. Drives queue counts, color classification, and reopen detection. |
| **ResolvedDate** | When it was resolved. Drives resolved charts, average resolution time, and **SLA compliance (≤240 hrs)**. |
| **AssigneeIdentity** | Who the ticket is assigned to. Drives per-agent breakdowns and "My Tickets". Logins not in our user database show up under **Non-registered logins** in drilldowns. |
| **ResolvedByIdentity** | Who resolved it (e.g. an agent, or `AutoSIM` for automated closures). Drives resolver stats. |

### Fields that power the deeper analytics
| Field | Used for |
|-------|----------|
| **RootCause** | The **Incident Type** classification and the repeat-incident (HI) breakdowns. |
| **RootCauseDetails** | Detecting **Historical Incident / Cnt > 0** (repeat incidents). |
| **ClosureCode** | e.g. `Immediately Resolved`, `Automatically Closed` — used to classify first-time pet incidents. |
| **Title** | Region detection (US/UK/CA/…) for the geographic breakdown. |

> Tip: Export from the source system with these columns present and correctly named. If `RootCause`/`RootCauseDetails` are missing, the incident-type and repeat-incident sections will be sparse, but core counts (queue, SLA, ages) still work as long as ShortId, CreateDate, Status, and ResolvedDate are present.

---

## 5. What information you can see

### Live Dashboard (everyone; ticket detail is logged-in only)
- **KPI summary** — total tickets, in-queue, resolved, AutoSIM, average resolution time, SLA %, and more.
- **Repeat Incident (HI) data** — repeat incidents (Cnt > 0), split into **pet vs non-pet**, with percentages and the pet-vs-non-pet gap.
- **Ticket Age Classification** — five color tiles:
  - **GREEN** 0–96 hrs (0–4 days)
  - **YELLOW** 96–168 hrs (4–7 days)
  - **RED** 168–240 hrs (7–10 days)
  - **BLACK** > 240 hrs (> 10 days)
  - **PURPLE** Reopened tickets (⚠ warning shows if a reopened ticket is held by someone outside the allowed reviewers)
  - Click any tile (logged in) to see the **per-agent breakdown**, split into **Registered users** vs **Non-registered logins**, and drill into each agent's tickets. Download CSVs per segment.
- **SLA Compliance per Week (≤240 hrs)** — a wave chart showing each week's SLA % for the current quarter, drawn as each week passes.
- **Incident Types** — ranked table; click a type (logged in) for the agent breakdown.
- **Historical Incidents (Cnt > 0)** — repeat-incident root-cause breakdown; click a row (logged in) for the agent breakdown.
- Daily and weekly **created vs resolved** charts.

### Other pages (logged-in)
- **Groups** — A1 / A2 / B group performance and totals.
- **Previous Week** — the prior week's created/resolved report.
- **Shift Report** — a copy-ready shift handoff summary (choose region).
- **My Tickets** — your own open tickets, deadlines (240h), and per-ticket comments.
- **PHD Tools** — Common Blurbs, Hashtags, and Paging contacts (with a **Copy** and a **View** button on each card). Admins can add/edit/delete blurbs and hashtags.
- **Update data log** — full audit history of every upload/publish and what changed.
- **Agent Analytics** and **Last 24 Hours** — available to **Admin+** (Managers are excluded from Agent Analytics). Last 24 Hours also shows a **Help Activity** section (see below).
- **Users** — **Owner only**: create accounts, set roles, reset passwords, remove users.

---

## 6. The Help feature — how contractors ask, and how you help them

Contractors (editors) can raise questions on their own tickets. Admins, Managers, and the Owner answer them.

### How a contractor asks for help
- On **My Tickets**, each of their tickets has an **Ask for help** button.
- They click it, type their question, and submit.
- **Only one open request per ticket at a time.** To ask another question on the same ticket, they must first close the current one with **Help received**.

### How you (Admin / Manager / Owner) help
1. On the **live dashboard**, look for the **Alerts** button beside the quarter title. A **red badge** shows the number of open help requests (it disappears when there are none). *The Alerts button is visible to all logged-in users, but only Admin+ can reply.*
2. Click **Alerts** to open the help popup. Each open request shows:
   - who asked (the contractor),
   - which ticket (linked),
   - their question,
   - any replies so far.
3. Type your reply in the box under a request and click **Reply**. Replies are **append-only and threaded** — you and others can add multiple replies over time, each attributed and timestamped.
4. The contractor sees your replies **inline on their My Tickets page**, in the thread for that ticket.

### Closing the loop
- When the contractor is satisfied, they click **Help received** on that request. It drops off the Alerts list but is **kept for the record** (nothing is deleted).
- Every question and answer is documented in **Last 24 Hours → Help Activity**, showing who asked, the ticket, the question, who replied, and whether it's open or resolved.

---

## 7. Quick operational checklist

- [ ] Logged in with my own account.
- [ ] Changed my temporary password (Profile → Security → Change Password).
- [ ] Set my display name / photo.
- [ ] Confirmed my CSV has: ShortId, CreateDate, Status, ResolvedDate, AssigneeIdentity, ResolvedByIdentity (plus RootCause / RootCauseDetails / ClosureCode / Title for full analytics).
- [ ] Uploaded via **Upload new data**, reviewed the **Upload Complete** summary.
- [ ] Checked the **Alerts** badge and answered any open help requests.
- [ ] Reviewed the **Update data log** if I need to audit a change.

---

## 8. FAQ / troubleshooting

**A visitor says they can't see tickets when clicking a tile.**
That's expected — ticket-level detail is logged-in only. Ask them to log in, or if they need an account, they can reach out to @harisss (linked in the "Login required" popup).

**An assignee like "vaine" shows under "Non-registered logins".**
That means the assignee's login isn't an account in our user database. It's informational — those tickets still count everywhere; they're just separated in the per-agent drilldown so you can tell registered users apart from unknown/default logins.

**My upload was flagged as "cross-quarter".**
Your CSV contained tickets from a quarter other than the live one. Review the prompt before confirming so you don't overwrite another quarter's data by accident.

**Where do I see who changed what?**
**Update data log** — it records each upload/publish with the change summary (added / updated / reopened / auto-closed / unchanged).

---

*For account creation, role changes, or password resets you can't do yourself, contact the Owner (@harisss).*
