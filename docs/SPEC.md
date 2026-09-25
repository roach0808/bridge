# Silver Horizon — Project Specification

The product is branded **Silver Horizon** (logo, favicon, app icons and sign-in banner in `apps/web/public/brand`); earlier versions of this document call it the God System, and the code keeps the `god` names.

Version 1.9 · 2026-09-25 · Status: Phase 1 implemented, deployed

This document is the single source of truth for the God System. It covers the
web version (Phase 1) and the mobile version (Phase 2) and is meant to be
extended as the project grows. Sections marked **[Assumption]** were decided
during planning and can be changed. Sections marked **[Implementation]**
record decisions made while building Phase 1.

---

## 1. Purpose

The God System coordinates **Call projects** between employees in an anonymous
way. A Call is an expert-consultation call that must be scheduled, performed,
and invoiced. Different roles are responsible for different stages, and the
system enforces who may move a Call to which status, in real time, from both a
PC browser and a mobile app.

### 1.1 Goals

- One shared, real-time view of every Call and its current status.
- Strict, server-enforced permissions per role and per stage.
- Anonymity: employees see each other only by nickname and role.
- One backend that serves the web app and, later, the mobile app unchanged.

### 1.2 Non-goals for version 1

- Public sign-up (accounts are created by the Founder or a Manager).
- Video or audio calling inside the system (calls happen on external platforms;
  the Expert shares a VDO.Ninja link on the call).
- Accounting integration (the invoice stages track status plus the real income
  the Founder records; nothing is exported).

---

## 2. Users and roles

| Role | Description | Managed by |
|---|---|---|
| **Founder** | Owner of the system. Full access. Handles invoice stages. Creates Managers. | — |
| **Manager** | Manages a team of Associates (creates, edits and deactivates their accounts). Works with **every** Associate's Calls, and can run Calls themselves like an Associate. | Founder |
| **Associate** | Creates and schedules Calls. Owns the scheduling stages. | Manager |
| **Expert** | Confirms and performs the Call. Owns the execution stages. Never sees invoicing or a call's income; sees only their own pay. | Founder |

### 2.1 Role hierarchy

```
Founder
├── Manager (many)
│     └── Associate (many, each belongs to exactly one Manager)
└── Expert (many)
```

**[Assumption]** An Associate belongs to exactly one Manager. Experts are not
grouped under Managers; they are assigned per Call.

### 2.2 Anonymity rules

- Every user has a **nickname**. The nickname, role, avatar and optional
  uploaded photo are the only identity fields ever returned by the API or
  shown in any client. A photo is the user's own choice and can reveal a
  face; the illustrated avatar remains the default.
- The email address is used only for login and lives in the auth layer. No
  endpoint returns it, except the user's own `/me` endpoint (and the login and
  refresh responses, which describe the caller) and the Founder's audited
  sign-in details (§6.2).
- There is no real-name field anywhere in the schema.
- Chat messages, tasks, status history entries, and assignments display
  nickname + role only.
- **[Implementation]** Call payloads also include the Expert's IANA time zone
  so clients can show the Expert's local time (§9.1 New Call).

### 2.3 Permission matrix

| Action | Founder | Manager | Associate | Expert |
|---|---|---|---|---|
| Create Manager | ✓ | | | |
| View users | all | every Associate and Expert | | |
| Create Associate | ✓ | ✓ (own team) | | |
| Create Expert | ✓ | | | |
| Deactivate user | ✓ | ✓ (own team) | | |
| Delete user | ✓ (not themselves) | | | |
| See a user's sign-in email, change it, unlink Google, end their sessions | ✓ (audited) | | | |
| Create / edit Platform | ✓ | ✓ | | |
| Add Profile | ✓ (approved at once) | ✓ (pending until a Founder approves) | ✓ (pending until a Founder approves) | |
| Edit Profile | ✓ | own pending or rejected submission | own pending or rejected submission (sends it back for review) | |
| View Profile details | all | shared + own team's submissions | shared + own submissions | Profiles of assigned Calls, without platform statuses |
| Set a Profile's status on a platform | ✓ | ✓ (Profiles their team looks after) | ✓ (Profiles they look after) | |
| Set a Profile's rate on a platform | ✓ | | | |
| Deactivate a Profile / see deactivated ones | ✓ | | | |
| Delete a Profile | ✓ | | | |
| See / edit a Profile's current address and banks | ✓ | | | |
| Upload own photo | ✓ | ✓ | ✓ | ✓ |
| Upload a Profile photo | ✓ | | | |
| Approve / reject a pending Profile | ✓ | | | |
| Choose own avatar (from own role's set) | ✓ | ✓ | ✓ | ✓ |
| Create Call | ✓ | ✓ | ✓ | |
| View Call | all | every Associate's + own | own | assigned |
| Reassign Associate on a Call | ✓ (to any Associate or Manager) | ✓ (to themselves or any Associate) | | |
| Reassign Expert on a Call | ✓ | ✓ (every Associate's + own) | ✓ (own, whole scheduling stage) | |
| Set scheduling statuses | override | override (own calls: ✓) | ✓ | request rescheduling only |
| Confirm a scheduled Call | override | | | ✓ |
| Set execution statuses | override | | | ✓ |
| Set invoice statuses | ✓ | | | |
| Delete a Call | ✓ | | | |
| See invoice statuses | ✓ | ✓ (every Associate's) | own | |
| See a call's income and rate (expected price, real income) | ✓ | ✓ (every Associate's) | | |
| See a Profile's platform rates | ✓ | ✓ | | |
| Close or reopen a bank account | ✓ | | | |
| Set a special rate for one Call | ✓ | ✓ (every Associate's + own) | | |
| Set the Call's research data link, mark the research data ready | ✓ | | | |
| Read the Call's research data link and Ninja link; see the "research data ready" step | ✓ | | | ✓ (assigned) |
| Add or change a Call's meeting details | ✓ | ✓ (every Associate's + own) | own, until it took place | |
| Read a Call's meeting details | ✓ | ✓ | ✓ | ✓ |
| Read the Call's Ninja (meeting) link | ✓ | | | ✓ (assigned; the Expert adds it when starting) |
| Set an Expert's hourly rate, a Profile's Manager share | ✓ | | | |
| Set an Associate's share (of the Manager's share) | ✓ | ✓ (own team) | | |
| See own pay (§3.1 "Who is paid what") | ✓ (everyone's) | own share and the Associate's part they pass on | their Manager's share and their own part | own pay |
| Pay everyone and close the monthly payment cycle | ✓ | | | |
| See the monthly payment records | ✓ (all) | own lines | own lines | own lines |
| Mark the Expert or the Manager paid for a call | ✓ | | | |
| Mark the Associate paid for a call | ✓ | ✓ (calls they are paid for) | | |
| Hand a Profile to another Associate | ✓ (anyone) | ✓ (between themselves and their own team) | | |
| See who is online (§7.6) | people they may chat with | same | same | same |
| Run / download a database dump | ✓ | | | |
| Post message in Call thread (switched off, §6.5) | ✓ | ✓ | ✓ | ✓ |
| Delete own chat message; react; send pictures | ✓ | ✓ | ✓ | ✓ |
| Clear a chat's whole history | the two people in it | same | same | same |
| Chat one-to-one (§6.11) | anyone | Founders, Managers, Associates, Experts | Founders, Managers | Founders, Managers |
| Give tasks (chat message or New task) | ✓ anyone | ✓ any Associate | | |
| View a Call's status history | ✓ | ✓ (every Associate's + own) | own | assigned (without invoicing steps) |
| View the audit trail (§6.16) | ✓ | | | |
| See and end own signed-in devices | ✓ | ✓ | ✓ | ✓ |
| See financial statistics (§6.14) | all | every Associate's + own | | |

**[Implementation]** A Call is always booked in the future: the API refuses a `scheduledAt` more
than five minutes in the past, on creation and when rescheduling, and the calendar does not offer
past slots.

**[Implementation]** Managers have every Associate function: a Call's Associate may be a
Manager, who then runs it exactly like an Associate (no overrides on their own Call), sees
it in their lists, calendar and statistics, and may hand it on. A Manager oversees **every**
Associate, not only their own team; only account changes (create, edit, deactivate) stay
limited to their team. A Manager's own Calls stay theirs: other Managers never see them.

"override" means the role may perform the transition on behalf of the normal
owner. Every override is recorded in the status history with the actor.

**[Assumption]** Managers may override scheduling statuses for every
Associate's Calls. Founder may override anything.

**[Implementation]** Field-level edit rules, computed server-side and returned
as `permissions` on every Call:

- `edit` (time, duration, platform, platform associate, project details,
  notes): the call's Associate, their Manager or the Founder while the call is
  in the scheduling stage; the Founder at any stage.
- `reassignAssociate`: Founder (to any Associate or Manager), or a Manager on
  any Associate's call or their own (to themselves or any Associate).
- `reassignExpert`: Founder, a Manager (every Associate's call and their own),
  or the call's Associate — for as long as the call is in the scheduling stage (through
  `confirmed`), which is where the Associate owns the status. The Expert still
  cannot be removed from a call that is `scheduled` or later.
- `editIncome`: Founder — corrects the real income of a call already processed
  to bank (409 once a share of it has been marked paid).
- `editResearchLink`: Founder.
- `editMeeting`: whoever owns scheduling, while the call is on its way
  (`ACTIVE_STATUSES`); the Founder at any stage.
- `editRate` is never given to an Associate: Associates see no rates or income.
- `editExpertRate`: Founder — the Expert's rate for one call that has taken
  place, until the Expert is marked paid for it (409 afterwards).
- `reassignAssociate` ends once the call is processed to bank: the shares are
  settled on its Associate.
- `editRate` (the special rate for one call): whoever owns scheduling — the
  call's Associate, a Manager, or the Founder.

**[Implementation] Hidden steps.** Some roles never see some statuses
(`statusForRole`, `hiddenStatusesFor` in `packages/shared/src/callStatus.ts`):
Associates and Managers see a call in `research_ready` as `confirmed`, without
the research step in its history, its status bar, their filters or their
notifications (a step nobody in a group can see tells that group nothing, and
the Expert starting the call reads to them as `confirmed → ongoing`).
Associates also never see a call's income or rate (`expectedPrice`,
`realIncome`, `platformRate`, `rateOverride` are null for them, Profile rates
too, and `/stats/finance` is 403); they see their Manager's share of their calls
and their own part (§3.1).

**[Implementation]** Experts never see invoicing or a call's income; the only
money they receive is their own pay (`payouts.expert`, §3.1). The server shows them
`invoice_submit`, `invoice_approve` and `process_to_bank` calls as `finished`
(in call payloads, lists, the calendar, dashboard counts and socket updates),
sends `expectedPrice`, `realIncome`, `platformRate` and `rateOverride` as null, leaves invoicing steps out of
their status history, treats a `finished` filter as including invoiced calls,
and does not notify them about invoicing transitions or income edits. The web
app drops the Invoicing stage from their status bar and filters
(`statusForRole`, `stagesForRole`, `statusFilterForRole` in
`packages/shared/src/callStatus.ts`).

---

## 3. Domain model

### 3.1 Entities

#### User

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| nickname | text, unique | Displayed everywhere |
| role | enum: founder, manager, associate, expert | |
| manager_id | uuid, nullable | Set only for Associates (check constraint) |
| email | text, unique | Login, and Google sign-in matching. Returned only to the user and (audited) to the Founder |
| password_hash | text | argon2id |
| is_active | boolean | Deactivated users cannot log in |
| deleted_at | timestamptz, nullable | Set when the Founder deleted the account (§6.2): email and nickname replaced, hidden from every list, past work kept |
| avatar_id | text → Avatar | Must be from the avatar set for the user's role |
| photo_id | uuid → Photo, nullable, unique | An uploaded picture, shown instead of the avatar |
| last_seen_at | timestamptz | Last time they were connected; shown as "last seen" when offline (§7.6) |
| time_zone | text (IANA name) | Default `America/New_York`. Only meaningful for Experts: where they live, e.g. `Asia/Seoul`. Everyone else works on New York time (§9.3) |
| hourly_rate | numeric(12,2), nullable | Experts: what they are paid per hour of call (USD). Set by the Founder; copied onto each call when it finishes |
| share_percent | numeric(5,2), nullable | Associates: their portion (percent) of their Manager's share of each call. Set by the Founder or the Associate's own Manager; 50 for a new Associate |
| created_at, updated_at | timestamptz | |

#### Platform

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| name | text, unique | |
| url | text | |
| priority | integer | Lower = higher priority |
| country | text (ISO 3166-1 alpha-2) | |
| created_at, updated_at | timestamptz | |

#### Profile

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| name | text | |
| linkedin_url | text, nullable | |
| brief_experience | text | |
| date_of_birth | date, nullable | |
| gender | text, nullable | Male, Female or Other in the web form |
| nationality, location | text, nullable | |
| education, career_history | text, nullable | Free text |
| current_address | text, nullable | Superseded by ProfileAddress; kept empty |
| email, phone | text, nullable | Shown to everyone but Experts. The email is where the Profile is contacted, unrelated to sign-in |
| onboarded_at | date, nullable | Founder only to set. Defaults to the approval date |
| avatar_id | text → Avatar | Must be from the profile avatar set |
| photo_id | uuid → Photo, nullable, unique | Uploaded by the Founder |
| status | enum: pending, approved, rejected | Profiles added by a Founder are approved at once; an Associate's or Manager's submission starts pending until a Founder approves or rejects it |
| is_active | boolean | Default true. A deactivated Profile is listed for Founders only and cannot be booked (409 `profile_not_approved`); its existing Calls carry on |
| deleted_at | timestamptz, nullable | Set when the Founder deleted a Profile that had calls: personal details, banks and addresses erased, renamed "Removed profile", hidden everywhere, calls kept |
| manager_share_percent | numeric(5,2) | The Manager's percent of this Profile's real income. Default 15; set by the Founder |
| associate_id | uuid → User, nullable | The Associate (or Manager) who looks after the Profile. Whoever submits a Profile looks after it; the Founder hands any Profile to anyone, a Manager moves Profiles their team looks after (or nobody does yet) between themselves and their own Associates (`PUT /profiles/:id/associate`) |
| created_by | uuid → User | Who added it |
| reviewed_by | uuid → User, nullable | Founder who approved or rejected |
| reviewed_at | timestamptz, nullable | |
| rejection_reason | text, nullable | Required when rejected |
| created_at, updated_at | timestamptz | |

#### ProfileAddress

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| profile_id | uuid → Profile | Deleted with the Profile |
| label | text | e.g. Home, Office (≤ 60 characters) |
| address | text | ≤ 1000 characters |
| sort_order | integer | Order the Founder entered them in |
| created_at, updated_at | timestamptz | |

A Profile has up to 10 labelled addresses. Founder only: never returned to other roles.

#### ProfilePlatformStatus

| Field | Type | Notes |
|---|---|---|
| profile_id, platform_id | uuid → Profile, uuid → Platform | Primary key together; deleted with either side |
| status | enum PlatformRegistration: not_registered, registered, banned | |
| updated_at | timestamptz | |

A Profile's standing on each expert network platform. A missing row means
`not_registered`. Only the Founder sets it; Experts don't see it.

#### Call

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| status | enum CallStatus | See §4 |
| platform_id | uuid → Platform | |
| profile_id | uuid → Profile | |
| associate_id | uuid → User (Associate or Manager) | Who runs the call's scheduling. A Manager may run calls themselves |
| expert_id | uuid → User (role expert), nullable | Required before `scheduled` |
| scheduled_at | timestamptz | Required. Can be moved, never cleared |
| duration_minutes | integer | Required. One of 15, 30, 45, 60 |
| ends_at | timestamptz | Kept by a database trigger: scheduled_at + duration. Used to prevent double booking |
| notes | text | Internal notes |
| project_details | text | Required, never blank. The project brief from the platform |
| platform_associate_name | text | Required, never blank. The platform's own staff contact, not our associate |
| ninja_link | text, nullable | Meeting link the Expert must add when starting the call. Sent only to the Founder and the Expert |
| gpt_link | text, nullable | The research data link (`researchLink` in the API), set by the Founder. Sent only to the Founder and the Expert. Required to mark the research data ready |
| meeting_details | text, nullable | How to join the platform's meeting (link, passcode, dial-in), ≤ 2000 characters. Added by whoever runs the call, their Manager or the Founder; read by everyone on the call |
| banked_at | timestamptz, nullable | When the call was processed to bank: its real income counts in the payment cycle it arrived in |
| rate_override | numeric(12,2), nullable | A special rate (USD per hour) for this Call only; falls back to the Profile's platform rate. Never sent to Experts |
| actual_duration_minutes | integer, nullable | Entered by the Expert when finishing; the booked `duration_minutes` (and the calendar slot) stay unchanged |
| rating | integer 1–5, nullable | From an earlier finish form that asked "How did the call go?". No longer asked for; kept for old calls |
| feedback | text, nullable | The note that went with that rating |
| real_income | numeric(12,2), nullable | What reached the bank (USD), entered by the Founder when moving the call to `process_to_bank` (required then, check constraint). Never shown to Experts |
| expert_rate | numeric(12,2), nullable | The Expert's `hourly_rate` when the call finished. Changing the Expert's rate later never changes it. The Founder may set it for one call (e.g. one that finished before the Expert had a rate) until the Expert is paid |
| manager_share_percent, associate_share_percent | numeric(5,2), nullable | The Profile's Manager share and the Associate's share (a percent of the Manager's share) when the call was processed to bank (required then); 0 for the Associate when a Manager ran the call |
| payee_manager_id | uuid → User, nullable | The Manager paid for the call, fixed when it was processed to bank: the Associate's Manager, or the Manager who ran it |
| expert_paid_at, manager_paid_at, associate_paid_at | timestamptz, nullable | When the Founder paid the Expert and the Manager, and when the Manager paid the Associate. Shares only once processed to bank; the Expert only with a rate (check constraints) |
| created_by | uuid → User | |
| created_at, updated_at | timestamptz | |

**[Implementation] Money on a call.** The *expected price* is not stored: it is
the rate (the call's `rate_override`, else the Profile's rate on the platform)
× the real duration, rounded to cents (`expectedPrice` in
`packages/shared/src/callStatus.ts`), and null until the call is finished or
while there is no rate. A call cannot be invoiced without a rate (409
`rate_required`). The *real income* is what the Founder records when the money
arrives, usually a little under the expected price.

**[Implementation] Who is paid what.** The Founder is the only payer, and pays
two people per call, never Associates directly:

- **The Expert**: `expert_rate` × the real duration, rounded to cents. Known
  once the call finished; payable from then on.
- **The Manager**: `manager_share_percent` (15 unless the Profile says
  otherwise) of the real income, once the call is processed to bank. The
  Associate's share (`associate_share_percent`, e.g. 50) is a **portion of
  the Manager's share**: with 15% and 50% the Associate gets 0.5 × 0.15 =
  7.5% of the income, which the Manager passes on, keeping the other 7.5%. A
  Manager who ran the call themselves keeps the whole share.

From the moment a call took place, every share also shows what it should come
to (`expected`, from the expected price and today's percents); the final
`amount` comes from the real income once the bank has paid.

Rates and shares are copied onto the call when they become final (the Expert's
rate at `finished`, the shares at `process_to_bank`), so changing a rate or a
share later only changes calls still to come. Each call carries `payouts`
(§6.8) with the lines the viewer may see: the Founder every line; the Expert
their own pay; the Manager being paid their share and the Associate's part they
pass on; the Associate their Manager's share (without its percent) and their
own part. The Founder marks the Expert and the Manager paid; the Manager marks
the Associate paid (the Founder may too). Each payee is notified (`call.paid`).

**[Implementation] Monthly payment cycles.** Everyone is paid once a month.
On payment day (usually in the first or second week) the Founder presses
**Pay everyone & close the month** (`POST /finance/cycles`): everything the
Founder owes — Experts' pay for calls that took place with a rate, Managers'
shares of calls paid to bank — is marked paid at that moment, each person is
told, and the cycle is kept as a `pay_cycles` row: its name, the window it
covers, the income that reached the bank in it, what was paid to Experts and to
Managers (and by Managers to Associates) and the balance, plus one line per
person. The next cycle starts from zero. A payment inside a closed cycle cannot
be marked unpaid (409 `payout_closed`).

#### PayCycle

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| label | text | e.g. "September 2026" (suggested: the previous month until the 15th) |
| started_at | timestamptz, nullable | The previous cycle's `closed_at`; null for the first |
| closed_at | timestamptz, unique | When the Founder paid everyone |
| closed_by | uuid → User | |
| income, paid_experts, paid_managers, paid_associates | numeric(14,2) | Real income banked in the window, and what was paid in it |
| lines | jsonb | [{ userId, kind: expert \| manager \| associate, amount, calls }] |
| created_at | timestamptz | |

#### Avatar (catalog, reference data)

| Field | Type | Notes |
|---|---|---|
| id | text | e.g. `associate-07` |
| audience | enum: founder, manager, associate, expert, profile | Which set it belongs to |
| style | text | Illustration style: notionists, toonHead, bigSmile, openPeeps, personas |
| seed | text | Selects the variant within the style |
| background | text | Hex background color |
| label | text | e.g. `Funny 07` |
| sort_order | integer | 1–24 within an audience |

24 avatars per audience, inserted by migration. Each audience has its own
mood: Founder *Executive* (notionists), Manager *Professional* (personas),
Associate *Funny* (bigSmile), Expert *Characterful* (openPeeps), Profile
*Portrait* (toonHead). The API draws them as SVG with pinned library versions
(`@dicebear/core` and `@dicebear/collection` 9.4.2), so a row always renders
the same picture. Art credits: Notionists by Zoish (CC0), ToonHead by Johan
Melin (CC BY 4.0), Big Smile by Ashley Seo (CC BY 4.0), Open Peeps by Pablo
Stanley (CC0), Personas by Draftbit (CC BY 4.0), via DiceBear.

#### ScheduleBlock (Expert availability and time off)

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| expert_id | uuid → User (role expert) | Deleting the Expert deletes their blocks |
| kind | enum: available, unavailable | Availability or time off |
| note | text | Seen only by the Expert and the Founder |
| time_zone | text (IANA name) | The Expert's zone when the block was made. The times below are wall-clock times in this zone |
| start_date | date | First day |
| all_day | boolean | |
| start_minute | integer | Minutes after local midnight, 0–1439 |
| duration_minutes | integer | 5–1440 |
| frequency | enum: none, daily, weekly, monthly, yearly | |
| interval | integer | Every N days, weeks, months or years (1–99) |
| weekdays | integer[] | Weekly: 1 = Monday … 7 = Sunday |
| month_day | integer, nullable | Monthly or yearly "on the 15th" |
| set_position | integer, nullable | Monthly or yearly "on the second Tuesday": 1–4, or −1 for the last |
| weekday | integer, nullable | The weekday paired with set_position |
| month | integer, nullable | Yearly: which month |
| until_date | date, nullable | Required when the block repeats; at most 3 years after start_date |
| exception_dates | text[] (ISO dates) | Dates removed from the series by "this event only" edits and deletes |
| created_by | uuid → User | The Expert or the Founder |
| created_at, updated_at | timestamptz | |

A block is a rule, not a row per day. The server expands it for the requested
range in the block's own zone, so "9:00 AM every weekday in London" stays
9:00 AM local time across daylight saving changes. The repeat forms cover:
every N days; chosen weekdays every N weeks; a day of the month, or a weekday
of the month such as the last Friday, every N months; and the same two forms
in a chosen month every N years.

#### Photo

| Field | Type | Notes |
|---|---|---|
| id | uuid | Random; the public URL is `/photos/{id}` |
| content_type | text | image/jpeg, image/png or image/webp (check constraint) |
| data | bytea | Cropped to a square and shrunk in the browser (320 px), at most 400 KB |
| byte_size | integer | Equals the data length |
| created_by | uuid → User | |
| created_at | timestamptz | |

Replacing or removing a picture deletes the old row, so storage never piles up.

#### ProfileBank

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| profile_id | uuid → Profile | Deleting the Profile deletes its banks |
| bank_name | text | Required, never blank |
| account_holder | text | Required, never blank |
| account_number | text | Account number or IBAN. Required |
| swift_bic, routing_number | text, nullable | |
| country | text (ISO 3166-1 alpha-2), nullable | |
| currency | text (ISO 4217), nullable | |
| is_active | boolean, default true | A closed account stays on file but no longer counts: the Profile then needs another one |
| notes | text, nullable | |
| is_primary | boolean | Exactly one primary per Profile that has banks (partial unique index) |
| created_by | uuid → User | |
| created_at, updated_at | timestamptz | |

A Profile may have any number of banks, including none. A Profile with at
least one **booked** call (status `scheduled` or later) must have a bank; until
it does, it appears in the Founder's pending tasks. Missing banks never block a
transition. Bank details are payment data: only the Founder reads or edits them.

#### CallStatusHistory (audit)

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| call_id | uuid → Call | |
| from_status | enum CallStatus, nullable | null on creation |
| to_status | enum CallStatus | |
| actor_id | uuid → User | |
| is_override | boolean | true when actor is not the normal owner |
| comment | text, nullable | |
| created_at | timestamptz | |

#### Message (per-Call thread, switched off)

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| call_id | uuid → Call | |
| sender_id | uuid → User | |
| body | text | |
| created_at | timestamptz | |

#### Notification

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| user_id | uuid → User | |
| type | text | call.status_changed, call.assigned, call.created, call.updated, call.message, call.paid, todo.assigned, todo.done, todo.completed, todo.reopened, profile.submitted, profile.approved, profile.rejected |
| payload | jsonb | callId, conversationId, todoId, profileId, from, to, actor nickname + role, summary |
| read_at | timestamptz, nullable | |
| created_at | timestamptz | |

#### Conversation (one-to-one chat)

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| user_a_id, user_b_id | uuid → User | The pair is stored once, with `user_a_id < user_b_id` (check constraint, unique pair) |
| user_a_last_read_at, user_b_last_read_at | timestamptz, nullable | Read markers for unread counts and "Seen" |
| last_message_at | timestamptz, nullable | Chats without messages are not listed |
| created_at | timestamptz | |

#### ChatMessage

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| conversation_id | uuid → Conversation | |
| sender_id | uuid → User | |
| body | text | At most 5000 characters. Blank only with a picture (then it is a caption) or once deleted (check constraints) |
| kind | enum: text, todo_done | `todo_done` is the reply posted when a task is marked done |
| reply_to_id | uuid → ChatMessage, nullable | For `todo_done`: the task's message |
| image_id | uuid → ChatImage, nullable, unique | A picture sent with the message |
| deleted_at | timestamptz, nullable | Set when the sender deleted it: body emptied, picture and reactions removed |
| created_at | timestamptz | |

#### ChatImage

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| conversation_id | uuid → Conversation | Only its two people may load it |
| uploader_id | uuid → User | |
| content_type | text | image/jpeg, image/png or image/webp; the bytes are checked |
| data | bytea | Shrunk in the browser to at most 1600 px and 1 MB |
| byte_size, width, height | integer | The size lets clients lay out before the picture loads |
| created_at | timestamptz | |

#### ChatReaction

| Field | Type | Notes |
|---|---|---|
| message_id, user_id, emoji | uuid, uuid, text | Primary key together: each emoji once per person per message; at most 10 per person |
| created_at | timestamptz | |

#### Todo

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| message_id | uuid → ChatMessage, nullable, unique | The chat message the task was made from (null for a standalone task) |
| title, details | text, nullable | A standalone task's title (required when there is no message) and details |
| confirmed_at | timestamptz, nullable | When the giver confirmed it; set exactly when status = completed |
| conversation_id | uuid → Conversation, nullable | Set exactly when the task came from a chat message |
| assignee_id | uuid → User | Who the task is for (the taker) |
| created_by | uuid → User | The giver: a Founder, a Manager, or the taker themselves (a personal to-do) |
| status | enum: open, in_progress, blocked, done, completed | **Not Started** (`open`) → **In Progress** → **Ready for Review** (`done`, the taker ticks it) → **Completed** (the giver confirms), with **Blocked** to one side. The two stored names are older than the words on screen (`TODO_STATUS_LABELS`); they were kept so every existing task stayed valid. A task you gave yourself goes straight to completed when you tick it. `done_at` is set exactly when done or completed (check constraint) |
| blocked_reason | text, nullable | Why the work cannot go on. Set exactly while the status is `blocked` (check constraint): a task nobody can explain is not a status |
| start_by_at, start_by_has_time | timestamptz nullable, boolean | **Start By**: the moment work should begin. `has_time` is false when only a day was given, and the time of day means nothing |
| complete_by_at, complete_by_has_time | timestamptz nullable, boolean | **Complete By**: the moment the work must already be finished. A check constraint keeps it at or after Start By |
| time_zone | text, nullable | The zone those times were written in; the owner's when nobody said otherwise |
| expected_deliverable | text, nullable | What must be produced or accomplished |
| definition_of_done | text, nullable | How anyone can tell it is finished |
| urgency | enum: need_action, can_wait, default need_action | Which column of the board the task sits in |
| importance | enum: strategic, non_strategic, default strategic | Which row of the board the task sits in. A new task, however it arrives, starts in **need action · strategic** |
| position | int, default 0 | Where the task sits within its quadrant; smaller is higher. Dragging renumbers that quadrant in steps of `TODO_POSITION_STEP` (100). Indexed with `assignee_id`, `urgency` and `importance` |
| done_at | timestamptz, nullable | |
| done_note | text, nullable | The assignee's note, also the body of the reply |
| done_message_id | uuid → ChatMessage, nullable, unique | The `todo_done` reply |
| created_at, updated_at | timestamptz | |

#### TodoDependency **[Implementation]**

What a task waits for: `(todo_id, depends_on_id)`, both to `todos`, deleted with
either. A task never waits for itself (check constraint) and never for anything
that already waits on it — a circle of tasks is a plan nobody can start, so the
API walks the chain and refuses one (409).

#### ProfilePlatformStatus rates

Each Profile × Platform row also carries `rate`: what that Profile is paid per
hour on that platform, in USD. It is **empty until the Founder sets one** and is
**required to mark the Profile `registered`** on that platform (400 with a
`rate` issue otherwise; a database check backs it up). It stays editable
afterwards, so marking a Profile registered is never a one-way decision. Only a
Founder changes it, and Experts never receive it (their `platformStatuses` is
null).

A Call may also carry `rate_override` for a project priced away from the
standard rate; the call's Associate, a Manager or the Founder sets it.

#### WebPushSubscription

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| user_id | uuid → User | Whoever signed in last in that browser |
| endpoint | text, unique | The push service URL for one browser profile |
| p256dh, auth | text | Encryption keys from the browser |
| user_agent | text, nullable | |
| created_at, last_seen_at | timestamptz | |

#### DbDump (database backups)

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| trigger | enum: scheduled, manual | The nightly run, or the Founder's "Run now" |
| succeeded | boolean | |
| error | text, nullable | Why it failed |
| byte_size | integer | Size of the gzipped JSON |
| table_counts | jsonb | Rows per table at the time of the dump |
| data | bytea, nullable | gzip of the JSON dump; null when it failed |
| created_at | timestamptz | |

A dump holds every table except `refresh_tokens` (session secrets, useless in a
copy). The newest 7 are kept; older rows are deleted after each run.

#### DeviceToken (Phase 2, table created in Phase 1)

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| user_id | uuid → User | |
| platform | enum: ios, android, web | |
| token | text, unique | Expo push token |
| created_at, last_seen_at | timestamptz | |

#### RefreshToken

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| user_id | uuid → User | |
| family_id | uuid | **[Implementation]** All tokens rotated from one login share a family, revoked together on reuse |
| token_hash | text, unique | SHA-256 of a random 256-bit token |
| expires_at | timestamptz, nullable | Null: the session lasts until signed out (the default, `REFRESH_TOKEN_TTL=never`) |
| revoked_at | timestamptz, nullable | |
| replaced_by | uuid, nullable | The token issued by the rotation |
| device_type, browser, os | text, nullable | Parsed from the user agent at sign-in: desktop, mobile or tablet |
| ip, country | text, nullable | The client IP and its two-letter country, when the proxy reports it |
| last_used_at | timestamptz | Last refresh in the family |

#### AuthIdentity (Google sign-in)

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| user_id | uuid → User | One per provider per user |
| provider | enum: google | |
| subject | text | Google's permanent account id (`sub`); unique per provider |
| email | text, nullable | The Google address when linked or last used |
| created_at, last_used_at | timestamptz | |

#### AuditLog

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| user_id | uuid → User, nullable | Who acted; null for a failed sign-in |
| actor_role, actor_name | text, nullable | As they were at the time |
| action | text | Dotted family and verb, e.g. `call.transition`, `bank.read`, `auth.login.failed` |
| summary | text | Plain wording ("moved a call to its next status") |
| entity_type, entity_id | text, nullable | |
| method, path, status_code | text, text, integer | The request as sent, and how it ended (failed attempts are kept too) |
| ip, country, device_type, user_agent, session_id | text, nullable | |
| device_id | uuid → Device, nullable | The browser it came from (§3.1 Device). Only the owner is shown it |
| meta | jsonb, nullable | e.g. the attempted email of a failed sign-in |
| created_at | timestamptz | Kept 365 days, trimmed after the nightly dump |

#### Device **[Implementation]**

A browser cannot read a MAC address — nothing on the web can — so each browser
keeps a random token of its own in local storage and sends it as `X-Device-Id`.
The API gives that token a readable name the first time it sees it, and the
audit trail points at it.

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| token | text, unique | What the browser sends. Never shown to anyone |
| label | text, unique | `US-desktop-01`: country, kind of machine, and which one of those it is. Numbered per country and kind |
| device_type | text | desktop, mobile, tablet or unknown, from the user agent |
| country | char(2), nullable | As the proxy reported it when the device was first seen |
| first_seen_at, last_seen_at | timestamptz | `last_seen_at` is refreshed at most hourly |

It names the browser, not the person: a second browser on the same machine, or
cleared site data, is a new device.

### 3.2 Relationships

```
User(manager) 1 ── * User(associate)
Platform     1 ── * Call
Profile      1 ── * Call
User(assoc)  1 ── * Call
User(expert) 1 ── * Call
User(expert) 1 ── * ScheduleBlock
Call         1 ── * CallStatusHistory
Call         1 ── * Message
Profile      1 ── * ProfilePlatformStatus * ── 1 Platform
User         2 ── * Conversation          (one per pair)
Conversation 1 ── * ChatMessage
Conversation 1 ── * ChatImage
ChatMessage  1 ── 0..1 ChatImage
ChatMessage  1 ── * ChatReaction
ChatMessage  1 ── 0..1 Todo              (standalone tasks have no message)
User         1 ── * Todo                  (as giver and as taker)
Profile      1 ── * ProfileAddress
Profile      1 ── * ProfileBank
User         1 ── * AuthIdentity
User         1 ── * RefreshToken
User         1 ── * AuditLog
Device       1 ── * AuditLog             (null when the browser sent no token)
User         1 ── * Notification
User         1 ── * DeviceToken
User         1 ── * WebPushSubscription
```

### 3.3 Database constraints

- All foreign keys enforced. Deleting a Platform, Profile, or User referenced
  by a Call is rejected by the database; the API instead erases a User's or
  Profile's identifying data and hides it (§6.2, §6.4). Deleting a Call removes
  its status history and messages with it (cascade).
- `status` is a Postgres enum. Invalid values are rejected by the database.
- Check constraint `calls_expert_required_when_scheduled`: `expert_id IS NOT
  NULL` whenever status is `scheduled` or later.
- Every call has `scheduled_at` and `duration_minutes` (NOT NULL,
  `calls_duration_allowed`), and `project_details` and
  `platform_associate_name` contain at least one visible character (checks
  `calls_project_details_present` and `calls_platform_associate_present`). The
  API checks the same things first, with clearer messages; the database is the
  backstop.
- Index on `calls(status)`, `calls(associate_id)`, `calls(expert_id)`,
  `calls(expert_id, scheduled_at)`, `calls(scheduled_at)`,
  `messages(call_id, created_at)`.
- Exclusion constraint `calls_expert_no_overlap` (needs the `btree_gist`
  extension): an Expert cannot have two calls whose `[scheduled_at, ends_at)`
  ranges overlap while both are in a blocking status: `scheduled`, `confirmed`,
  `on_rescheduling`, `ongoing`, `finished`, `invoice_submit`,
  `invoice_approve` or `process_to_bank`. `on_scheduling` is tentative and
  never blocks. Ranges are half-open, so a call ending at 10:00 and one
  starting at 10:00 are fine. The API reports a clash as 409 `expert_busy`.
- `schedule_blocks` check constraints: start minute 0–1439, duration 5–1440
  minutes, interval 1–99, weekdays within 1–7 and required for weekly
  repeats, and an end date exactly when the block repeats, no more than 1096
  days (3 years) after its start.
- **[Implementation]** Also: `platforms_country_format`,
  `profiles_rejection_reason_required`, `users_manager_only_for_associates`,
  `calls_real_income_nonnegative`, `calls_paid_has_real_income`,
  `calls_rating_range` (1–5), `calls_actual_duration_positive`,
  `calls_rate_override_nonnegative`, `conversations_ordered_pair`,
  `chat_messages_has_content`, `chat_messages_deleted_is_empty`,
  `chat_reactions_emoji_short`, `todos_done_at_when_done`,
  `todos_confirmed_when_completed`, `todos_has_subject`,
  `todos_message_in_conversation`,
  `profile_platform_statuses_rate_when_registered`, `users_hourly_rate_nonnegative`,
  `users_share_percent_range`, `profiles_manager_share_range`,
  `calls_expert_rate_nonnegative`, `calls_shares_range` (the Associate's part
  within the Manager's share), `calls_paid_has_shares`,
  `calls_share_paid_when_banked`, `calls_expert_paid_when_priced`.

---

## 4. Call status workflow

### 4.1 Statuses

| Status | Stage | Owner |
|---|---|---|
| on_scheduling | Scheduling | Associate |
| scheduled | Scheduling | Associate |
| confirmed | Scheduling | Expert |
| research_ready | Scheduling | Founder |
| on_rescheduling | Scheduling | Associate or Expert |
| ongoing | Execution | Expert |
| finished | Execution | Expert |
| invoice_submit | Invoicing | Founder |
| invoice_approve | Invoicing | Founder |
| process_to_bank | Invoicing | Founder |
| cancelled | Cancelled | Associate |

"Associate" in this section means whoever runs the Call: its Associate, or a
Manager running a Call of their own (§2.3), who then acts exactly like an
Associate, without overrides.

A new Call starts in `on_scheduling`: tentative, the Expert is optional and the
Expert's time is not blocked. `on_rescheduling` is a booked call sent back: the
Expert is required and the old slot stays blocked until it is scheduled again.
`research_ready` means the Founder prepared the research data the Expert reads
before the call; only the Founder and the Expert see it (Associates and
Managers see `confirmed`, §2.3). `cancelled` is a call called off before it ran: it is terminal, it frees the
Expert's slot, it is left off the calendar, and it earns nothing (it counts in
no statistics and blocks neither a Profile nor a User from being deleted). It is
not a stage of the workflow but a dead end beside it (`TRACK_STAGES` is the
three stages a call travels through).

### 4.2 Allowed transitions

```
on_scheduling ──(Associate)──► scheduled
scheduled ──(Expert)──► confirmed
scheduled ──(Associate or Expert)──► on_rescheduling
confirmed ──(Associate or Expert)──► on_rescheduling
on_rescheduling ──(Associate)──► scheduled
confirmed ──(Founder)──► research_ready
research_ready ──(Associate or Expert)──► on_rescheduling
research_ready ──(Expert)──► ongoing
research_ready ──(Expert)──► finished
confirmed ──(Founder, override for the Expert)──► ongoing
confirmed ──(Founder, override for the Expert)──► finished
ongoing ──(Expert)──► finished
finished ──(Founder)──► invoice_submit
invoice_submit ──(Founder)──► invoice_approve
invoice_approve ──(Founder)──► process_to_bank
on_scheduling ──(Associate, Manager, Founder)──► cancelled
scheduled ──(Associate, Manager, Founder)──► cancelled
confirmed ──(Associate, Manager, Founder)──► cancelled
research_ready ──(Associate, Manager, Founder)──► cancelled
on_rescheduling ──(Associate, Manager, Founder)──► cancelled
```

Rules:

- Ownership passes with the stage: once `scheduled`, the Associate can no
  longer move the Call forward, only back to `on_rescheduling`.
- The Expert confirms a scheduled time (`confirmed`: they are available and
  will take the call); then the Founder marks the research data ready
  (`research_ready`, which needs the research data link: 400 without one, and
  the step can carry it as `researchLink`). Only then can the Expert start or
  finish the call; the Founder alone may skip the research step (an override).
- Either the Associate or the Expert can send a scheduled or confirmed call
  back to `on_rescheduling`; neither counts as an override. An Expert must give
  a reason (400 without a comment), and the web app first reminds them to
  update their calendar so the Associate can find their new availability.
- Changing the time or duration of a `confirmed` or `research_ready` call moves
  it back to `scheduled` (with a history row and notifications): the Expert
  confirms again, then the Founder marks the research data ready again.
- Moving to `ongoing` requires a `ninjaLink` (a URL). Moving to `finished`
  requires `actualDurationMinutes` (1–600), and nothing else: the Expert only
  says how long the call took. Missing or invalid values are 400 with field
  issues.
- Moving to `invoice_submit` needs a rate (the call's special rate or the
  Profile's rate on the platform); without one it is 409 `rate_required`.
  Moving to `process_to_bank` requires `realIncome` (USD, what reached the
  bank).
- A Call cannot be booked, or rescheduled, more than five minutes in the past.
- Once `ongoing` or `finished`, the Associate has no transitions. Only the
  Founder may act after `finished`.
- A call can be called off while it has not started (`CANCELLABLE_STATUSES`:
  `on_scheduling`, `scheduled`, `confirmed`, `research_ready`, `on_rescheduling`) by whoever runs
  it, any Manager, or the Founder. The Expert never cancels — they ask for
  rescheduling instead — and a call that has run cannot be cancelled. An
  optional comment says why, and reaches everyone with the notification.
- `process_to_bank` and `cancelled` are terminal.
- Overrides (§2.3) follow the same edges; only the allowed actor set widens.

### 4.3 Transition rule table (shared package)

The rules live in one place, `packages/shared/src/callTransitions.ts`, as data:

```ts
export const TRANSITIONS: Transition[] = [
  { from: 'on_scheduling',   to: 'scheduled',       roles: ['associate', 'manager', 'founder'] },
  { from: 'scheduled',       to: 'confirmed',       roles: ['expert', 'founder'] },
  { from: 'scheduled',       to: 'on_rescheduling', roles: ['associate', 'manager', 'expert', 'founder'] },
  { from: 'confirmed',       to: 'on_rescheduling', roles: ['associate', 'manager', 'expert', 'founder'] },
  { from: 'on_rescheduling', to: 'scheduled',       roles: ['associate', 'manager', 'founder'] },
  { from: 'confirmed',       to: 'research_ready',  roles: ['founder'] },
  { from: 'research_ready',  to: 'on_rescheduling', roles: ['associate', 'manager', 'expert', 'founder'] },
  { from: 'research_ready',  to: 'ongoing',         roles: ['expert', 'founder'] },
  { from: 'research_ready',  to: 'finished',        roles: ['expert', 'founder'] },
  { from: 'confirmed',       to: 'ongoing',         roles: ['founder'] },
  { from: 'confirmed',       to: 'finished',        roles: ['founder'] },
  { from: 'ongoing',         to: 'finished',        roles: ['expert', 'founder'] },
  { from: 'finished',        to: 'invoice_submit',  roles: ['founder'] },
  { from: 'invoice_submit',  to: 'invoice_approve', roles: ['founder'] },
  { from: 'invoice_approve', to: 'process_to_bank', roles: ['founder'] },
  { from: 'on_scheduling',   to: 'cancelled',       roles: ['associate', 'manager', 'founder'] },
  { from: 'scheduled',       to: 'cancelled',       roles: ['associate', 'manager', 'founder'] },
  { from: 'confirmed',       to: 'cancelled',       roles: ['associate', 'manager', 'founder'] },
  { from: 'research_ready',  to: 'cancelled',       roles: ['associate', 'manager', 'founder'] },
  { from: 'on_rescheduling', to: 'cancelled',       roles: ['associate', 'manager', 'founder'] },
];

export function canTransition(role, from, to, ctx): boolean
```

`ctx` carries the relationship check: the Associate must be the Call's
associate, the Expert must be the Call's expert, and a Manager must oversee the
Call (any Associate's Call, or one they run themselves; `supervisesWork` in
`packages/shared/src/chat.ts`). The server enforces this function; clients use it only to
decide which buttons to render. Each edge also has its normal owners
(`EDGE_OWNERS`; rescheduling belongs to both the Associate and the Expert), and
anyone else allowed is recorded as an override, except the person running
the Call (`isOverride(role, from, to, { isCallAssociate })`).

**[Implementation]** Error precedence on `POST /calls/:id/transition`: a call
the user cannot see is 404; an edge not in the table is 409
`invalid_transition`; a valid edge the user may not take is 403; entering
`scheduled` without an Expert is 409 `expert_required`, and without meeting
details 400 with a `meetingDetails` issue.

**[Implementation]** Entering `scheduled` (from `on_scheduling` or
`on_rescheduling`) requires the **meeting details**: nobody can join a call
they have no way into. The transition carries them when the call has none yet,
and they are stored with it; a call that already says how to join needs nothing
repeated. Blank is no detail.

### 4.4 Side effects of a transition

Every successful transition, in one database transaction (with the call row
locked `FOR UPDATE`):

1. Updates `calls.status`.
2. Inserts a `call_status_history` row.
3. Stores the step's extra fields: `meetingDetails` for `scheduled`;
   `researchLink` for `research_ready`; `ninjaLink` for `ongoing`;
   `actualDurationMinutes` (and the Expert's current rate as `expert_rate`) for
   `finished`; `realIncome`, the shares and the payee Manager for
   `process_to_bank`.
4. Creates `notifications` for every other participant of the Call
   (associate, expert, associate's manager, founder), except that the Expert
   is not notified about invoicing steps.
5. After commit, emits `call:updated` and `notification:new` (§7.3) and sends
   browser push notifications (§7.5).

### 4.5 Proposed future statuses (not in v1)

- `no_show` — reachable from `scheduled` by Expert. Returns to Associate for
  rescheduling.

---

## 5. Architecture

### 5.1 Stack (PERN + Expo)

| Layer | Technology | Version |
|---|---|---|
| Runtime | Node.js | 22 LTS |
| Language | TypeScript, strict | 5.x |
| API | Express | 5 |
| Validation | Zod | 3.x |
| ORM / migrations | Prisma | 6.x |
| Database | PostgreSQL | 16 |
| Real-time | Socket.IO | 4.x |
| Auth | JWT (access) + rotating refresh tokens, argon2id | |
| Web | React 19, Vite, React Router 7, TanStack Query 5, **Material UI 7** (with MUI X Date Pickers 8, Luxon adapter) | |
| Mobile (Phase 2) | React Native via Expo SDK, Expo Router, expo-secure-store, expo-notifications | |
| Monorepo | pnpm workspaces + Turborepo | |
| Testing | Vitest (unit), Supertest (API), Playwright (web e2e) | |
| Local infra | Docker Compose (Postgres) | |
| Browser push | Web Push (`web-push`, VAPID) + a service worker | |
| Hosting **[Implementation]** | Vercel (web), Render (API), Aiven PostgreSQL | |

**[Implementation]** Material UI replaces Tailwind CSS (product decision). The
theme uses CSS variables with light and dark color schemes, Inter, and fixed
role, stage and status palettes.

### 5.2 Repository layout

```
god-system/
├── apps/
│   ├── api/          Express + Socket.IO server
│   ├── web/          React (Vite) web app
│   └── mobile/       Expo app (Phase 2)
├── packages/
│   ├── shared/       Types, Zod schemas, status enum, transition rules, recurrence engine
│   └── api-client/   Typed fetch wrapper + socket client, used by web and mobile
├── docker-compose.yml
├── docker-compose.prod.yml
├── turbo.json
├── pnpm-workspace.yaml
└── docs/
    └── SPEC.md       This file
```

### 5.3 Design constraints (mobile-ready from day one)

- The API is pure JSON. No server-rendered HTML, no redirects, no form posts.
- Auth accepts `Authorization: Bearer <jwt>`. The web app additionally uses
  an httpOnly cookie (path `/api/v1/auth`) for the refresh token; the mobile
  app uses secure storage and sends it in the body.
- API base URL and allowed CORS origins are environment variables.
- The server listens on `0.0.0.0` so a phone on the same network can reach it.
- All endpoints are prefixed `/api/v1`.
- Responses return complete objects with nested nicknames, not view-shaped
  fragments.
- No browser-only globals (`window`, `localStorage`, `document`) in
  `packages/*`.
- All outgoing notifications route through a single `notify()` service so push
  delivery can be added without touching call sites.
- Timestamps are stored and transmitted in UTC ISO-8601; clients render in the
  viewer's timezone.
- **[Implementation]** JSON bodies and query strings accept both camelCase
  and snake_case keys (normalized to camelCase); responses are camelCase.

### 5.4 Server module layout

```
apps/api/src/
├── index.ts               bootstrap, http + socket server, graceful shutdown
├── app.ts                 express app (helmet, CORS, pino-http, routers)
├── config.ts              env parsing (Zod)
├── db.ts                  Prisma client
├── errors.ts              typed HTTP errors, DB error mapping
├── http.ts                parsing helpers
├── serializers.ts         anonymity-safe selects and DTO mappers
├── auth/                  login, Google sign-in, refresh, logout, /me, sessions, middleware
├── users/                 CRUD + team queries
├── avatars/               catalog + SVG rendering
├── platforms/
├── profiles/
├── chat/                  one-to-one chat, pictures, reactions and tasks
├── stats/                 statistics by Associate, by Profile, and finance
├── audit/                 audit trail middleware and the Founder's audit list
├── backup/                nightly database dumps and audit trail trimming
├── images.ts              shared image decoding and checks
├── calls/
│   ├── calls.routes.ts    incl. history and (switched-off) messages
│   ├── calls.service.ts   create, list, get, update, transition, broadcast
│   ├── calls.serialize.ts
│   └── calls.access.ts    who can see / act on a call
├── calendar/              calendar privacy, schedule blocks
├── dashboard/             role landing data
├── notifications/
│   ├── notify.ts          single entry point: db row + socket + (push)
│   ├── push.ts            Expo push adapter (Phase 2, off unless PUSH_ENABLED)
│   ├── webPush.ts         browser push (off unless VAPID keys are set)
│   └── notifications.routes.ts  incl. devices and browser push subscriptions
└── realtime/              socket auth, room joins, emit helpers
```

---

## 6. API specification (v1)

All routes are under `/api/v1`. All request and response bodies are JSON.
Errors use `{ error: { code, message, details? } }` with appropriate HTTP
status codes: 400 validation (`details.issues[]` with `path` and `message`),
401 unauthenticated (`token_expired` when the access token expired), 403
forbidden, 404 not found, 409 invalid transition or conflict (`expert_busy`
when the Expert already has a call at that time), 429 rate limited.

### 6.1 Auth

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | /auth/login | { email, password } | Returns { accessToken, refreshToken, user }; also sets the refresh cookie |
| GET | /auth/config | — | { googleClientId } for the login page; null when Google sign-in is off (`GOOGLE_CLIENT_ID` unset) |
| POST | /auth/google | { credential } | **[Implementation]** Sign in with Google. The API verifies the Google ID token (signature, audience = our client ID, expiry, verified email). A Google account already linked (`auth_identities`, matched by Google's `sub`) signs that user in; otherwise it links to the user whose sign-in email equals the Google address, once. Unknown addresses, a second Google account for the same user and deactivated users are refused. Same response and session as /auth/login |
| POST | /auth/refresh | { refreshToken } or cookie | Rotates refresh token |
| POST | /auth/logout | { refreshToken } or cookie | Revokes the token family |
| GET | /me | | Current user incl. email |
| PATCH | /me/password | { current, next } | |
| PATCH | /me/avatar | { avatarId } | Any user; must be from their role's set |
| PATCH | /me/time-zone | { timeZone } | Experts only (403 for others). IANA name such as `Asia/Seoul` |
| GET | /avatars | ?audience | Catalog list, signed-in users |
| GET | /avatars/:id.svg | | The avatar image. Public (image tags can't send tokens); cacheable |

Access token: 15 minutes (it carries the session id, `sid`). Refresh token:
rotated on every use and stored hashed; by default it never expires, so a
session lasts until the user signs out, is signed out from Settings or by the
Founder, or is deactivated (`REFRESH_TOKEN_TTL` sets a limit when wanted).

**[Implementation] Sessions.** Each sign-in is one session (a refresh-token
family) that records the device type, browser, OS, IP and country.

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | /me/sessions | any user | The caller's signed-in devices, newest use first; `current` marks this one |
| DELETE | /me/sessions/:id | any user | Signs that device out; `all` signs out every other device. { signedOut } |
| GET | /users/:id/sessions | Founder | Someone else's devices (audited) |
| DELETE | /users/:id/sessions | Founder | Signs them out everywhere |
| GET | /me/google | any user | The caller's linked Google account, or null |

### 6.2 Users

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | /users | Founder, Manager | Manager sees every Associate and every Expert. Query: role, q, active |
| POST | /users | Founder, Manager | Manager may create Associates only. time_zone accepted for Experts only |
| GET | /users/:id | Founder, Manager | |
| PATCH | /users/:id | Founder, Manager | nickname, manager_id, is_active; time_zone for Experts, Founder only. A Manager changes only their own team's Associates (403 otherwise). Founder only: `hourly_rate` (Experts; with `apply_rate_to_unpriced_calls: true` it also goes to their finished calls without a rate) and `share_percent` (Associates, also by their own Manager: their portion of the Manager's share). Rates and shares are returned to the Founder, an Associate's share also to their own Manager, and to each person on `/me` |
| GET | /users/me/team | Manager | Associates under this Manager |
| DELETE | /users/:id | Founder | Deletes the account, keeping its work (see below) |
| GET | /users/:id/sign-in | Founder | { email, google } — audited |
| PATCH | /users/:id/sign-in | Founder | { email }: changes the sign-in email |
| DELETE | /users/:id/google | Founder | Unlinks the Google account |

### 6.3 Platforms

| Method | Path | Who |
|---|---|---|
| GET | /platforms | all |
| POST | /platforms | Founder, Manager |
| PATCH | /platforms/:id | Founder, Manager |

**[Implementation]** Platform links (`url`) are kept for the Founder's edit form
but not shown anywhere else, and are not part of Call payloads.

### 6.4 Profiles

| Method | Path | Who |
|---|---|---|
| GET | /profiles | all. Query: q, status. Approved profiles are shared; pending and rejected ones are visible to the Founder, the author, and the author's Manager. Experts see only the Profiles of Calls assigned to them |
| GET | /profiles/:id | same visibility |
| POST | /profiles | Founder, Manager, Associate. { name, linkedinUrl?, briefExperience?, avatarId, dateOfBirth?, gender?, nationality?, location?, education?, careerHistory?, email?, phone?, onboardedAt? (Founder only), addresses? (Founder only, up to 10 { label, address }) }. A Founder's profile is approved at once; anyone else's is pending and every active Founder gets `profile.submitted` |
| PATCH | /profiles/:id | Founder (no re-approval), or the author of a pending or rejected submission (sends it back to pending and notifies the Founders). Approved profiles: Founder only |
| POST | /profiles/:id/approve | Founder. Pending only; author is notified |
| POST | /profiles/:id/reject | Founder. { reason } required; author is notified |
| PATCH | /profiles/:id/active | Founder. { isActive }. A deactivated Profile disappears for everyone else and cannot be booked |
| DELETE | /profiles/:id | Founder. See "Deleting a Profile" in §6.9a |
| PUT | /profiles/:id/associate | Founder, Manager | { associateId: uuid \| null }. Who looks after the Profile (§3.1). The Founder chooses any active Associate or Manager, or nobody; a Manager moves a Profile their team looks after (or nobody does yet) to themselves or one of their own Associates (403 otherwise) |
| PUT | /profiles/:id/platforms/:platformId | Founder; Manager or Associate for Profiles they may edit (`canEditPlatforms`: the Associate looking after it and that Associate's Manager). { status?: not_registered \| registered \| banned, rate?: USD per hour (Founder only; 403 otherwise), 0–1,000,000, two decimals, or null to clear }. At least one of the two. A Profile can be registered without a rate; invoicing its calls still needs one |

Profile responses include the personal details and `platformStatuses`: one
entry per platform ({ platform: { id, name, priority }, status, rate }) in priority
order, `not_registered` when never set. Experts get `platformStatuses: null`,
and `email`, `phone` and `onboardedAt` null. `addresses`, `bankCount` (open
accounts only) and `needsBank` are null for everyone except the Founder.
`associate` (who looks after it) is null for Experts; `canAssign` says whether
the viewer may hand it on; `managerSharePercent` goes to Founders and Managers.
`PATCH /profiles/:id` takes `managerSharePercent` from the Founder only.

A call can only be created with an approved profile (409
`profile_not_approved`).

### 6.5 Calls

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | /calls | all | Scoped per role (§2.3). Query: status (repeatable), associate_id, expert_id, platform_id, from, to, q, sort, page, pageSize |
| POST | /calls | Founder, Manager, Associate | { platform_id, profile_id, associate_id?, expert_id?, scheduled_at, duration_minutes, project_details, platform_associate_name, notes?, meeting_details? }. The profile must be approved and active, and the time not in the past. The Founder must pass associate_id (any Associate or Manager); a Manager passes any Associate or leaves it out to run the call themselves |
| DELETE | /calls/:id | Founder | Deletes the call for good, with its status history and messages (cascade) and every notification about it; statistics and income stop counting it. Emits `call:deleted` to its participants, whose open pages leave it. The audit trail keeps its record, including the deletion |
| GET | /calls/waiting | all | { count } of calls held up at the caller's own step (§9.3 sidebar badge): scheduling steps for Associates and Managers, confirm/start/finish for Experts, invoicing for the Founder |
| GET | /calls/:id | participants | Includes platform, profile, associate, manager, expert and the history (`messages` is always empty while messaging is off) |
| PATCH | /calls/:id | per §2.3 | associate_id, expert_id, platform_id, scheduled_at, duration_minutes, project_details, platform_associate_name, notes, real_income (Founder, once paid), research_link (Founder only), meeting_details (`editMeeting`), rate_override, expert_rate (Founder, once the call took place). scheduled_at and duration_minutes can change but not be cleared. 409 `expert_busy` if a booked call would overlap another |
| POST | /calls/:id/transition | per §4 | { to, comment?, researchLink? (for `research_ready`), ninjaLink?, actualDurationMinutes?, realIncome? } → 200 with updated Call; 400 when a required field for the step is missing (§4.2); 409 (invalid edge, or `expert_busy` when moving to a blocking status would double-book the Expert) |
| GET | /calls/:id/history | participants | Status history (Experts: without invoicing steps) |
| GET | /calls/:id/messages | participants | **Switched off** (404). Cursor paginated when on |
| POST | /calls/:id/messages | participants | **Switched off** (404). { body } when on |

### 6.5a Finance **[Implementation]**

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | /finance/calls | all | The caller's own financial dashboard: calls from `finished` on that pay them or that they pay out of — everything for the Founder; for a Manager the calls they are paid for and their own and their team's calls still on the way to the bank; an Associate their own calls; an Expert the calls they took. Query: paid = all \| unpaid \| paid, from, to, q, page, pageSize (≤ 200, default 50). Returns a page of Calls (with `payouts`) and `summary` (income, expert, manager, associate, keeps), which counts every matching call whatever the paid filter |
| GET | /finance/cycle | Founder | The open payment cycle: { startedAt, income, paid: { experts, managers, associates }, balance, expectedPipeline, toPay: [{ user, kind, amount, calls }], unpricedExpertCalls, suggestedLabel } |
| POST | /finance/cycles | Founder | { label }. Pays everyone the Founder owes and closes the cycle (§3.1 "Monthly payment cycles"); 201 with the record. 409 when a cycle was closed less than 10 minutes ago |
| GET | /finance/cycles | all | Closed cycles, newest first: { id, label, startedAt, closedAt, closedBy, totals, lines }. The Founder gets everything; anyone else only the cycles they were paid in, with only their own lines and `totals: null` |
| POST | /finance/payouts | Founder; Manager for `associate` | { payee: expert \| manager \| associate, callIds (1–500), paid = true }. Marks that person's pay as paid (or, with `paid: false`, not paid after all) on every call. All or nothing: 409 `payout_unavailable` when one of the calls has nothing to mark for the caller (not finished, no rate, not paid to bank, not the Manager paid for it). Returns { updated }; each newly paid person gets one `call.paid` notification per batch. 409 `payout_closed` when unmarking a payment made in a closed cycle |

"Unpaid" means something the viewer pays or is paid is still open on the call,
now or once the bank pays: for the Founder the Expert or the Manager, for a
Manager their share or the Associate's part, for an Associate their part, for
an Expert their pay.

**[Implementation]** Per-Call message threads are switched off
(`FEATURES.messages` in `packages/shared/src/features.ts`): the routes return
404 and the web app hides the thread. Existing rows are kept. Conversations
now happen in one-to-one chat (§6.11).

### 6.6 Notifications

| Method | Path | Notes |
|---|---|---|
| GET | /notifications | Own, newest first; `X-Unread-Count` header and `unreadCount` in the body. Query: unread, limit |
| POST | /notifications/read | { ids } or { all: true } |
| GET | /push/config | { publicKey }: the VAPID public key, or null when browser push is off |
| POST | /push/subscriptions | { endpoint, keys: { p256dh, auth } }. Saves this browser for the caller; a browser that belonged to someone else moves to the caller |
| DELETE | /push/subscriptions | Query: endpoint. Called on sign-out and when turning notifications off |
| POST | /push/test | Sends a test notification to the caller's browsers. 409 when push is off or no browser is subscribed |

### 6.7 Devices (Phase 2, endpoint shipped in Phase 1)

| Method | Path | Body |
|---|---|---|
| POST | /devices | { platform, token } |
| DELETE | /devices/:token | |

### 6.8 Call response shape

```json
{
  "id": "…",
  "status": "scheduled",
  "platform":  { "id": "…", "name": "…", "country": "KR", "priority": 1 },
  "profile":   { "id": "…", "name": "…", "linkedinUrl": "…", "briefExperience": "…", "avatarId": "profile-03" },
  "associate": { "id": "…", "nickname": "…", "role": "associate", "avatarId": "associate-02" },
  "manager":   { "id": "…", "nickname": "…", "role": "manager", "avatarId": "manager-03" },
  "expert":    { "id": "…", "nickname": "…", "role": "expert", "avatarId": "expert-04", "timeZone": "Asia/Seoul" },
  "scheduledAt": "2026-09-15T09:00:00.000Z",
  "durationMinutes": 60,
  "endsAt": "2026-09-15T10:00:00.000Z",
  "notes": "…",
  "projectDetails": "…",
  "platformAssociateName": "…",
  "expectedPrice": null,
  "realIncome": null,
  "platformRate": 1000,
  "rateOverride": null,
  "researchLink": null,
  "meetingDetails": null,
  "ninjaLink": null,
  "actualDurationMinutes": null,
  "rating": null,
  "feedback": null,
  "allowedTransitions": ["on_rescheduling"],
  "permissions": { "edit": true, "reassignAssociate": false, "reassignExpert": false, "editIncome": false, "editResearchLink": false, "editRate": true, "editExpertRate": false },
  "payouts": {
    "expert": null,
    "manager": null,
    "associate": null,
    "canMark": []
  },
  "bankReady": null,
  "createdBy": { "id": "…", "nickname": "…", "role": "associate", "avatarId": "…" },
  "createdAt": "…",
  "updatedAt": "…"
}
```

`allowedTransitions` and `permissions` are computed server-side for the
requesting user so clients never guess. `payouts` is too (§3.1): `expert`
{ user, rate, minutes, amount, paidAt } from `finished` on, `manager`
{ user, percent, amount, keeps, paidAt } and `associate` { user, percent,
amount, paidAt } once paid to bank, each only for the viewers who may see it,
and `canMark` lists the lines the viewer may mark. `bankReady` (Founder only)
says whether the Profile has an open bank account. For Experts, `status` never shows an
invoicing status and every money field is null (§2.3); `researchLink` and `ninjaLink` go only
to the Founder and the call's Expert. Associates get the money fields null too,
and see `research_ready` as `confirmed`.

### 6.9 Calendar and availability

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | /calendar | all | Query: from, to (at most 62 days apart), expertId? |
| GET | /calendar/experts | Founder, Manager, Associate | Every active Expert side by side. Query: from, to (same limits). 403 for Experts |
| POST | /experts/:expertId/schedule-blocks | that Expert, Founder | Add availability or time off, in the Expert's zone |
| PATCH | /schedule-blocks/:id | that Expert, Founder | { scope: this \| following \| all, occurrenceDate?, changes } |
| DELETE | /schedule-blocks/:id | that Expert, Founder | Query: scope, date? |

**Block body:** { kind, startDate, allDay, startMinute, durationMinutes,
repeat, note? }, where `repeat` is { frequency, interval, weekdays, monthDay,
setPosition, weekday, month, untilDate } (§3.1 ScheduleBlock). A repeating
block needs an end date; the web app offers 1 week, 1 month, 3 months, 6 months,
1 year, or a chosen date.

**Editing a repeating block** works like a desktop calendar:

- `this`: removes that date from the series and adds a one-off block with the changes.
- `following`: ends the series the day before and starts a new series from that date with the changes.
- `all`: changes the whole series in place.

Deleting takes the same scopes. A series with no dates left is removed.
PATCH and DELETE return { updated, deleted, created }.

**Who sees what** on `GET /calendar`:

- An Expert sees only their own calendar. Asking for another Expert returns 403.
- Founder, Manager and Associate can open any Expert's calendar. They get the
  calls they could already see in the call list (§2.3). The Expert's other
  calls in a blocking status (§3.3) come back only as `busy`
  { startsAt, endsAt }, with no profile, platform or associate; calls still
  `on_scheduling` come back as `busy` with `tentative: true` ("Being
  scheduled"). An Associate therefore never sees another Associate's call.
- Block notes and the editable rules (`rules`) go only to the Expert and the
  Founder, who also get `canEditBlocks: true`.
- Without `expertId`, non-Experts get their own visible calls across all Experts.
- `GET /calendar/experts` applies the same rules to every active Expert at once:
  { from, to, experts: [{ expert, slot, calls, busy, occurrences }] }. `slot`
  is the Expert's position by join date. The web app picks the Expert's color
  from it, so an Expert keeps the same color between visits.

Response: { from, to, expert, canEditBlocks, calls, busy, occurrences, rules }.
`occurrences` are the blocks expanded for the range.

### 6.9a Banks and photos

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | /profiles/:id/banks | Founder | Primary first |
| POST | /profiles/:id/banks | Founder | { bankName, accountHolder, accountNumber, swiftBic?, routingNumber?, country?, currency?, notes?, isActive?, isPrimary? }. The first bank becomes primary |
| PATCH | /banks/:id | Founder | Any field; `isPrimary: true` moves the primary flag here; `isActive: false` marks the account closed (kept on file, no longer counts) |
| DELETE | /banks/:id | Founder | If it was primary, the oldest remaining bank becomes primary |
| PUT | /me/photo | any user | { dataUrl } — a `data:image/(jpeg\|png\|webp);base64,…` URL, ≤ 400 KB; bytes must match the declared type |
| DELETE | /me/photo | any user | |
| PUT / DELETE | /profiles/:id/photo | Founder | Same body |
| GET | /photos/:id | public | Cacheable, like avatar images |

Profile responses carry `photoId`, and for the Founder `bankCount` (open
accounts) and `needsBank` (null for everyone else). A Profile whose accounts
are all closed counts as having no bank.

**[Implementation] Deleting a Profile.** `DELETE /profiles/:id` (Founder, audited). Refused (409) while the Profile has calls that are not finished. A Profile with no calls is removed entirely, with its banks, addresses and platform statuses. One with past calls has its personal details, banks, addresses and picture erased, is renamed "Removed profile", deactivated and hidden from every list (`deleted_at`), while its calls, income and history stay.

**[Implementation] Deleting a user.** `DELETE /users/:id` (Founder, audited) erases what identifies the account: email (replaced with an unusable one), password, Google link, sessions, push devices, notifications and picture; the nickname becomes "Removed user <id>" and the account is deactivated for good, freeing the old email and nickname. Their calls, chat messages, tasks, status history and audit entries stay and name the removed user. Refused for yourself, the last Founder, a Manager who still has Associates, and anyone with calls that are not finished.

**[Implementation] Sign-in details (Founder).** `GET /users/:id/sign-in` (audited) returns { email, google }; `PATCH /users/:id/sign-in` { email } changes the sign-in email; `DELETE /users/:id/google` unlinks the Google account so the next Google sign-in links again by email. `GET /me/google` shows the caller's own link. These are the only endpoints besides /me and sign-in that return an email, and only to the Founder.

### 6.10 Dashboard **[Implementation]**

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | /dashboard | all | { today: { date, zone, ongoing, upcoming, finished }, byStatus, team? (Manager), tasks? (Founder), database? (Founder) }, scoped like the call list |

- `today` uses the viewer's zone (§9.3): Experts their own, everyone else New
  York. `ongoing` is every call in `ongoing`; `upcoming` is today's calls in
  `scheduled`/`confirmed`/`on_rescheduling`; `finished` is today's calls in
  `finished` or an invoice status. Tentative `on_scheduling` calls are left out.
- `byStatus` for Experts counts invoiced calls under `finished`.
- `tasks.invoicesToSubmit`: calls in `finished` (no invoice submitted yet).
- `tasks.callsNeedingResearch`: calls still to come that need the Founder's
  research data: `confirmed` ones waiting for "Research data ready", and
  `scheduled` or `on_rescheduling` ones without a link yet.
- `tasks.profilesNeedingBank`: Profiles with a booked call and no open bank
  account, with the number of booked calls and the next upcoming one.
- `tasks.profilesNeedingRate`: Profile × platform pairs with finished calls but
  no rate, which therefore cannot be invoiced.
- `team` (Manager): per-Associate counts by status for their own team.
- `database`: current database size and per-table sizes.

### 6.11 Chat and tasks **[Implementation]**

One-to-one chats. Who may chat with whom (`canChat` in
`packages/shared/src/chat.ts`, enforced by the API):

- a Founder with anyone;
- a Manager with Managers, with any Associate and with any Expert;
- Associates and Experts with Managers and Founders only.

Associates don't chat with other Associates, nor Experts with Experts. A chat
that the rules no longer allow stays readable, with `canSend: false`.

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | /chat/contacts | all | Active users the caller may chat with |
| GET | /chat/conversations | all | The caller's chats with at least one message, newest first: { id, other (+ isActive), lastMessage (with `hasImage`, `deleted`), unreadCount, openTodoCount, otherLastReadAt, canSend, canGiveTask } |
| POST | /chat/conversations | all | { userId }. Opens or creates the chat (201). 403 when the rules don't allow it |
| GET | /chat/conversations/:id | the two people | 404 for anyone else |
| GET | /chat/conversations/:id/messages | the two people | Pages of `limit` (≤ 100) messages, oldest → newest: the latest without cursors, older ones with `cursor` (a page's `nextCursor`), newer ones with `after` (a page's `newerCursor`, while `hasNewer`). Each message: { id, sender, body, kind, replyTo, todo, image, deleted, reactions: [{ emoji, userIds }], createdAt } |
| POST | /chat/conversations/:id/messages | the two people | { body }. 403 when the other person is inactive or no longer allowed (`canSend: false`) |
| POST | /chat/conversations/:id/read | the two people | Marks the chat read (204) |
| POST | /chat/conversations/:id/messages (pictures) | the two people | **[Implementation]** { body, image?: { dataUrl, width, height } }. The browser shrinks a picture to at most 1600 px and 1 MB (JPEG, PNG or WebP; the bytes are checked); the body is then an optional caption. Pictures live in `chat_images` |
| GET | /chat/images/:id | the two people | The picture bytes (`Cache-Control: private`) |
| DELETE | /chat/conversations/:id/history | either of the two people | Erases every message, picture and reaction in the chat for both. Tasks made from the chat are kept, each keeping the message's words as its title. Emits `chat:cleared` |
| DELETE | /chat/messages/:id | the sender | Deletes for both: body erased, picture row deleted at once, reactions removed; a "deleted" placeholder stays. 409 for a message that is a task or a task's done reply. Emits `chat:message-updated` |
| POST | /chat/messages/:id/reactions | the two people | { emoji }. Toggles the caller's reaction (up to 10 per person per message); not on deleted messages or closed chats. Emits `chat:message-updated` |
| POST | /chat/messages/:id/todo | a participant who may give the other person tasks | Turns a regular message into a task for the other person (`todo.assigned`), in **need action · strategic** like any new task. Founder → anyone, Manager → any Associate, anyone → themselves (`canGiveTask`); 403 otherwise, 409 if already a task |
| DELETE | /chat/messages/:id/todo | the giver | Removes an open task. 409 once done |
| GET | /todos/assignees | all | People the caller may give a task to: themselves first, then everyone below them (every Associate for a Manager, everyone for the Founder) |
| PATCH | /todos/:id | the giver, and anyone who may give the owner tasks | Changes a task after it was given: `title` (not for a chat task, whose words are the message), `details`, the two dates, `expectedDeliverable`, `definitionOfDone`, the quadrant, `dependsOn`. **Not the owner**: a deadline you can move yourself is not a commitment to anyone, though a task you gave yourself is yours either way |
| POST | /todos/:id/status | the owner, or anyone who may change the task | { status: open \| in_progress \| blocked, blockedReason? }. Where the work stands. `blocked` must say why (400 otherwise), and tells the giver (`todo.blocked`). Finishing is `done`, not this: that asks the giver for something. 409 once the task is finished |
| POST | /todos | all | { assigneeId, title, details?, urgency?, importance?, startByAt?, startByHasTime?, completeByAt?, completeByHasTime?, timeZone?, expectedDeliverable?, definitionOfDone?, dependsOn? }: a task without a chat message. Anyone may add one for themselves; nobody is notified about their own. Without a quadrant it lands in **need action · strategic** |
| POST | /todos/:id/move | the giver (to someone else), the taker or the giver (within one board) | { assigneeId, urgency?, importance? }: hands an open task to someone else the giver may give tasks to (dragged onto their board); it goes to the top of the quadrant it was dropped on, or, with no quadrant, to **need action · strategic** — a task given to you always turns up in the same corner — and they get `todo.assigned`. 409 for a task from a chat (it stays with that chat) or one that is no longer open. With the same `assigneeId` it only places the task in a quadrant of that person's own board, keeping the one it has if none is given |
| POST | /todos/reorder | the board's owner, or anyone who may give them tasks | { assigneeId, ids, urgency?, importance? }: the new top-to-bottom order of one quadrant (what the filter hides keeps its order below it). Tasks dragged in from another quadrant move into it. 409 when an id is not that person's. Emits `chat:todos-reordered` |
| DELETE | /todos/:id | the giver | Removes a task that is open, or completed and no longer needed. 409 while it waits for confirmation |
| GET | /todos/board | all | The task board: the caller's own panel first, then one per person below them (every Associate for a Manager; everyone for the Founder). Each panel: the person, whether the caller may give them tasks, their tasks (whoever gave them) and counts. Query: status as below |
| GET | /todos | giver or taker | Query: scope = assigned (default) \| created, status = active (default: open, done, and tasks completed within the last 7 days) \| open \| done \| completed \| all. Open first |
| POST | /todos/:id/done | the taker | { note? }. open → done; for a chat task posts a `todo_done` reply (body = note or "Done"). The giver gets `todo.done`. A task the taker gave themselves goes straight to completed, with nobody to confirm and nobody to tell |
| POST | /todos/:id/confirm | the giver | done → completed (`confirmed_at`); the taker gets `todo.completed`. Completed tasks leave the default list |
| POST | /todos/:id/reopen | the giver | { note? }. done or completed → open, clearing the done state; the taker gets `todo.reopened` |

Sending a message counts as reading the chat. A chat message is pushed to the
other person's browsers (§7.5) and raises a toast in their open app; it does
not create a bell notification.

### 6.11a Everyone's chats, for the owner **[Implementation]**

Chats are private between the two people in them (§6.11). The one exception is
the **owner** of the system (`OWNER_EMAIL`, §3.1 Device): they read every chat,
and only read. No other Founder sees these endpoints — they are 403 for
everybody else, including other Founders.

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | /chat/observed | the owner | Every conversation with at least one message, newest first (500 max): { id, people: [UserRef, UserRef], lastMessage, messageCount, createdAt } |
| GET | /chat/observed/:id/messages | the owner | A page of one chat, same shape and cursors as §6.11 |

Looking on must not look like taking part: reading a chat this way leaves no
read receipt (neither person's "Seen" moves, and their unread counts stand),
sends nothing, gives no task and reacts to nothing. The owner is not a
participant, so the ordinary chat endpoints still answer 404 for them.

Both reads are **recorded in the audit trail** (`chat.observed.list`,
`chat.observed.thread`, §6.16) — the most sensitive read there is.

Web: **Everyone's chats** (`/chat/all`), reached by the eye button on the Chat
page, which only the owner is shown. `MeDTO.isOwner` tells the client.

### 6.11b Start By and Complete By **[Implementation]**

A due date read as a start date is the mistake the task board exists to
prevent, so execution timing and accountability timing are separate fields,
separately sorted and separately shown:

| | Meaning |
|---|---|
| **Start By** | Begin work no later than this date, or date and time |
| **Complete By** | The work must already be finished by this moment |

A day with no time of day is stored as the start of that day with
`hasTime` false, so "Thursday" stays a day and never becomes midnight for a
reader in another zone. A time is shown in the reader's zone, with the owner's
beside it when they differ; the interface never says "EOD" or "tomorrow".

**Priority** (P1, P2, P3) is not a field anyone sets: it follows from the
quadrant, so a task cannot be P1 on one screen and "can wait" on another.
Need action · Strategic is P1; Can wait · Non strategic is P3; the two mixed
quadrants are P2 (`priorityOf`).

**Sorting** lives in `packages/shared/src/tasks.ts` as two pure functions:

- **Execution** (`byExecution`): Start By date, then Start By time (a whole day
  comes before the same day with an hour on it), then priority, then Complete By.
- **Deadline** (`byDeadline`): Complete By, then priority, then Start By.

A task with no date sorts **last** in both, never first.

**Risk** (`taskRisk`): `overdue` past the deadline; `high_risk` due today and
not started; `at_risk` due tomorrow and not started; `on_track` once someone has
picked it up. A task with no deadline, or one already finished, says nothing.
A deadline with **no start date** raises its own warning (§14 of the PRS): "No
start date assigned. Team member may not know when to begin this task."

### 6.12 Presence **[Implementation]**

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | /presence | all | `[{ userId, status, lastSeenAt }]` for everyone the caller may chat with (§6.11 rules); `lastSeenAt` is filled in only when offline |

Live changes arrive over the socket as `presence:update` (§7.6).

**[Implementation]** Clients show two states: **on the platform** (online or idle) as a blue dot, and **away from it** as a grey dot with "Last seen …".

### 6.13 Database dumps **[Implementation]**

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | /db-dumps | Founder | The kept dumps, newest first: { id, trigger, succeeded, error, byteSize, tableCounts, createdAt } |
| POST | /db-dumps | Founder | Runs one now ("Run now" on the dashboard) and returns it |
| GET | /db-dumps/:id/download | Founder | The gzipped JSON as a file (`god-dump-<timestamp>.json.gz`) |

A dump runs every night at 03:00 team time, checked every 15 minutes, and
catches up on start when a day was missed (the API sleeps on free hosting).
`DB_DUMPS_ENABLED=false` turns the schedule off.

### 6.14 Statistics **[Implementation]**

Periods are weeks (Monday start), two-week blocks (aligned on Monday 2026-01-05) or calendar months in the team time zone (America/New_York). A call belongs to the period of its scheduled time. Query for the period endpoints: `period` = week (default) \| biweek \| month, `count` = 1–24 periods ending with the current one (default 8).

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | /stats/associates | Founder (all Associates, and Managers who ran calls), Manager (every Associate and themselves), Associate (self) | Per Associate and period: calls, finished calls, potential money and unpriced calls, plus totals. Potential money = rate × duration, the real duration once the Expert finished the call and the booked duration before; the rate is the call's special rate or the Profile's platform rate. Calls without a rate count as unpriced. Deactivated Associates appear only with calls in the range. Experts: 403. Associates get their call counts only: `showsMoney: false` and potential 0 |
| GET | /stats/profiles | Founder | Every Profile including pending, rejected and deactivated: status, active, onboard date, email, primary bank (name, country, currency, count), calls, paid calls, expected income (finished calls), total income (sum of real income), last call already started. Audited as a sensitive read |
| GET | /stats/finance | Founder (everyone), Manager (every Associate's calls and their own), Associates and Experts 403 | Per period, and over the range per platform and per Profile: calls, finished calls, paid calls, expected (expected price of finished calls), paidExpected and real (calls with real income), gap = paidExpected − real, unpriced |

Web: **Statistics** (Founder, Manager, Associate — call counts only for Associates, without the Finance tab) with Weekly / Bi-weekly / Monthly, the *By associate* and *Finance* tabs (Expected, Real income, Gap on paid calls, Not paid yet; tables by period, platform and Profile with expected-vs-real bars), each scoped to the calls the viewer can see. Founders also get the *By profile* table (filters All / Active / Deactivated / Pending / Rejected, sort, search).

### 6.15 Health

`GET /healthz` (outside `/api/v1`) returns `{ status, db, uptime }`; 503 when
the database is unreachable.

### 6.16 Audit trail **[Implementation]**

Every change (POST, PATCH, PUT, DELETE) and every sensitive read (bank details,
database dumps, someone's sessions or sign-in details, the Profile statistics)
is recorded once the response is known, so refused attempts (403, 409) are kept
too. Reading the trail itself is **not** recorded: it only filled the trail with
itself, and the entries it had left were cleared by the `payouts_and_profile_associates` migration. Token refreshes, read receipts and presence
are skipped as noise. Each entry has the actor, a plain summary, the request,
its outcome, and the device, IP and country (§3.1 AuditLog). A failed sign-in
keeps the attempted email; a successful one does not.

**The device** (§3.1 Device) is named in the entry as `US-desktop-01`, and
**only the owner Founder** (`OWNER_EMAIL`, `andrewlong0808@gmail.com`) is shown
it: for every other Founder the field is null and the column is not drawn. A
request from a browser that sent no token is recorded as before, with no
device.

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | /audit | Founder | Newest first, paginated. Query: userId, action (a family such as `call` matches `call.transition`…), from, to, q, page, pageSize. Emails in the list are masked (`ma***@domain`) |
| GET | /audit/actions | Founder | The action names in use, for the filter |

Entries are kept 365 days, trimmed after each nightly dump. Web: **Audit**
(Founder) with filters by person, action and dates.

---

## 7. Real-time (Socket.IO)

### 7.1 Connection

- Client connects with `auth: { token: <accessToken> }`.
- Server verifies the JWT and that the user is active, then joins the socket to room `user:{id}`.
- On reconnect the client re-sends the current token; an auth failure triggers one token refresh and retry.

### 7.2 Rooms

| Room | Members |
|---|---|
| user:{id} | That user's every device |
| call:{id} | Joined on demand while a Call detail screen is open |

### 7.3 Server → client events

| Event | Room | Payload |
|---|---|---|
| call:updated | participants' user rooms | Full Call object, computed per recipient |
| call:deleted | participants' user rooms | { id }: the Founder deleted the call; open pages leave it |
| call:message | call:{id} | Message with sender nickname + role |
| notification:new | user:{id} | Notification |
| user:typing | call:{id} | { callId, userId, nickname } |
| presence:update | user:{id} | `PresenceDTO[]`: who came online, went away or left (§7.6) |
| session:revoked | user:{id} | Sent before a deactivated user's sockets are dropped |
| chat:message | both people's user rooms | ChatMessage |
| chat:todo | giver's and taker's user rooms | Todo, or { id, conversationId, messageId, removed: true } (ids null for standalone tasks) |
| chat:todos-reordered | the taker, the actor, every Founder and Manager | { assigneeId }: that panel has a new order |
| chat:read | both people's user rooms | { conversationId, userId, readAt } |
| chat:message-updated | both people's user rooms | ChatMessage, after a delete or a reaction |
| chat:cleared | both people's user rooms | { conversationId }: the chat's history was erased |

**[Implementation]** `call:updated` goes to each participant's `user:{id}`
room rather than `call:{id}`, because `allowedTransitions` and `permissions`
differ per viewer. Every member of a call room is a participant, so they
receive it too.

### 7.4 Client → server events

| Event | Payload |
|---|---|
| call:join | { callId } — server checks access before joining; optional ack { ok } |
| call:leave | { callId } |
| user:typing | { callId } |
| presence:active | — | This tab is in use (on focus, then at most once a minute) |
| presence:away | — | This tab went to the background, or the person went idle |

Messages are posted over HTTP (§6.5, §6.11) and broadcast by the server; the
socket is never the only path for a write.

**[Implementation]** The client starts with HTTP long-polling and upgrades to
WebSocket when it can, because the Vercel rewrite in front of the API forwards
HTTP but not WebSocket upgrades.

### 7.5 Browser push notifications **[Implementation]**

- Delivered with Web Push (VAPID) to a service worker (`apps/web/public/sw.js`),
  so they arrive even when the site is closed. Off unless `VAPID_PUBLIC_KEY` and
  `VAPID_PRIVATE_KEY` are set; every server sharing a database must use the
  same pair.
- Sent for every stored notification (same wording as the bell, from
  `notificationText` in the shared package) and for every chat message
  (title = sender, one notification per chat, newer replaces older).
- Not shown when the person is already looking: the chat is open and focused,
  or, for other notifications, any app window is focused (the app shows those
  itself). Clicking focuses the app and opens the chat or page.
- Subscriptions whose push service answers 404/410 are deleted.
- The web app asks once (a prompt on Chat and Tasks; Settings → Browser
  notifications has on/off and "Send a test"). On sign-in the browser's
  subscription moves to the signed-in user; on sign-out it is detached.
- Where push is unavailable but permission is granted, the open tab shows
  the notifications itself while hidden.
- iPhone and iPad: only after Add to Home Screen (the web app has a manifest
  and icons).

---

### 7.6 Presence **[Implementation]**

Everyone sees whether the people they may chat with are at their screen.

| Status | Meaning |
|---|---|
| **online** | A socket is connected and the tab reported activity within the last 5 minutes |
| **away** | Connected, but the tab is in the background or idle for 5+ minutes |
| **offline** | No socket. Clients show "last seen …" from `users.last_seen_at` |

- Presence lives in memory in the API process; only `last_seen_at` is written
  (on connect, on disconnect, and while a tab stays open). More than one API
  instance would need a shared store.
- The chat rules of §6.11 decide who learns about whom, so an Associate never
  sees an Expert's presence and nobody sees people they cannot message.
- The web app shows two states only: online and away both as a blue dot
  ("Online"), offline as a grey dot with "Last seen …". Every avatar of a user
  whose presence the viewer may know carries the dot; your own is always blue.
- A sweeper flips idle connections to `away` once a minute.

---

## 8. Security

- Passwords hashed with argon2id. Unknown emails still cost a hash comparison, so response timing doesn't reveal which emails exist.
- JWT signed with HS256, secret from environment, 15-minute expiry.
- Refresh tokens random 256-bit, stored hashed, rotated, family revoked on
  reuse detection. Sessions last until signed out by default; users see and
  end their devices in Settings, and the Founder can end anyone's.
- **[Implementation]** Sign in with Google: the API verifies Google's ID token
  itself (signature, our client ID, expiry, verified email) and only signs in
  users the Founder created; the password stays available.
- Rate limit `/auth/login` (5 per minute per IP). **[Implementation]** Only
  failed attempts count, so an office behind one IP is not locked out.
- All access decisions made on the server using the shared rule table plus
  relationship checks. Clients never send their role. The user is reloaded
  from the database on every request, so deactivation and role changes take
  effect immediately.
- Helmet headers, strict CORS allowlist, request body limit 2 MB (chat pictures).
- Audit: every status change recorded with actor and override flag, plus the
  full audit trail of changes and sensitive reads (§6.16).
- Deleting a user or a Profile erases its identifying data rather than its
  history (§6.2, §6.4).
- Deactivated users: refresh rejected, refresh tokens revoked, sockets disconnected.
- Logs redact authorization headers, cookies, passwords, refresh tokens and emails.
- **[Implementation]** `TRUST_PROXY` sets how many proxy hops' `X-Forwarded-For`
  to trust (2 behind Vercel → Render), so the login limit counts real client IPs.

---

## 9. Web application (Phase 1)

### 9.1 Screens

| Screen | Roles | Content |
|---|---|---|
| Login | all | Email + password, and "Sign in with Google" when the API has a Google client ID |
| Dashboard | all | **Today**: Ongoing, Coming up and Finished calls, one line each (time, profile, platform, Expert). Founder: **Pending tasks** (finished calls to invoice, calls to prepare research data for (confirmed ones waiting for “Research data ready”, and booked ones without a link), Profiles that need a bank, with an Add bank shortcut, and Profiles that need a rate), the **database size**, and **Backups** (the last nightly dump with its size and row count, Run now, and Download per kept dump). Manager: team counts per stage |
| Calls | all | Three tabs. **In progress**: the calls still on their way (being scheduled or running; cancelled ones on request), a table with filters (status, associate, expert, date range, search) and live updates, filters in the URL; **When** reads in plain words ("in 13 hours" over "Tomorrow 11 AM · 45 min"); a **Research data** column for the Founder and the Expert (Open, or "Not added yet" on a booked call); and a Cancel button on every call the viewer may cancel. **Finance**: each person's own financial dashboard over the calls that took place (§6.5a). The Founder's panel shows **this payment cycle** (income received, paid out, current balance, and what is still expected), what is owed to Experts and to Managers, and **Pay everyone & close the month** (a dialog lists who is paid what, and the cycle's name); a Manager sees income, their share (received, owed, expected), what they owe their Associates and what they keep; an Associate their Manager's share of their calls and their own part — never the income; an Expert their pay to date. One row per call with its income (Founder and Managers: expected and real), and each visible payee's amount — "exp." until the bank has paid — with a paid mark. The Founder and Managers select rows and press **Paid to expert / manager / associate**; the menu undoes a payment that did not happen (not in a closed cycle). **Payment records**: every closed cycle, newest first — for the Founder its income, what was paid to Experts and Managers, the balance and who was paid what; for everyone else what they were paid |
| Call detail | participants | Header with "View profile details", the platform, when it is in plain words, and — once finished, for the Founder and Managers — its income as a pill with both figures (Expected and Real). The Details card has **Income** ("Expected $1,000/h × 33 min = $550", "Real $540" or "waiting for bank") and **Meeting details** (link, passcode…; whoever runs the call, their Manager or the Founder edits it in place; everyone on the call reads it, links clickable). A **Delete call** button for the Founder, the status bar (Experts: without Invoicing; Associates and Managers: without the research step), transition buttons from `allowedTransitions` — the Founder's **Research data ready** asks for the research data link — and a quiet **Cancel call** button while the call has not started; a warning before **Invoice submitted** when the Profile has no open bank account; assignment controls; status history; a Call card (Ninja link, Founder and Expert only); a **Research data** card (the Founder adds the link, the Expert opens it; first on the page while the call is being prepared); a **Payouts** card (each visible payee's amount, expected until the bank pays, and whether it is paid, with Mark paid for whoever pays; the Founder corrects the Expert's rate for the call there); and a **Rate** card for the Founder and Managers. Starting asks for the Ninja link; finishing asks only for the real duration; an Expert requesting rescheduling is reminded to update their calendar and must give a reason |
| New Call | Founder, Manager, Associate | Required fields are marked with *. In this order: Profile (approved and active only, no inline create); Project (platform, platform associate, project details, meeting details, notes; Associate for Founder and Manager); When (date, time, duration); Expert last, with the Expert's local time and whether they're free. A Manager runs the call themselves by default, or picks any Associate. Past times are refused. Saving asks for confirmation when the time is today, clashes with another call, or falls in time off. Accepts `?expertId=&start=&duration=` from the calendar |
| Calendar | all | Day, week and month views of an Expert's time off and calls (§6.9). Every call block carries a status badge (SCHEDULING, SCHEDULED, CONFIRMED, RESCHEDULING, ONGOING, DONE, INVOICED, APPROVED, PAID) next to its colour; others' calls still being scheduled show as "Being scheduled"; past slots cannot start a call. Experts drag to add time off; others drag to start a call. Extra clocks for team time, the Expert's zone and a client zone. Availability (working hours) is hidden in the web app for now; the API still supports it. An "All experts" view (not for Experts) splits each day into one column per Expert, each in a fixed color: an empty column is a free Expert, and dragging across a time lists who is free, with a Schedule button for each |
| Profiles | all | Two tabs. **Profiles**: one table: profile, status, **Associate** (who looks after it), **Pending** (what is still missing, one item per line: review, email, phone, bank, onboard date, platform registration), **Platforms** — the priority-one platform by name with a green dot where the Profile is registered and a red one where it is not (a red ring when banned), and "+N"; clicking unfolds every platform's status underneath the row — and open / edit buttons. No rates in the table. Filters All / Mine (an Associate's own Profiles; My team for a Manager) / Pending / Approved / Rejected, and for the Founder Needs bank / Deactivated; search. Anyone but Experts adds a profile (the Founder's are approved at once) | **Platform status** (not for Experts): **every** Profile, with no status filter and no review banner — those belong to the Profiles tab. One row per Profile and one narrow column per platform, the platform's name on its side and a green or red dot in each cell (the words are in the tooltip and in the menu). Because the company works with dozens of networks, the columns are **one priority at a time**: a row of buttons, one per platform priority in use with how many platforms it holds, plus All. A **Manager** column (the Associate's Manager, or the Manager themselves when one looks after the Profile) and a Manager filter beside the priority buttons. The Founder, and the Associate looking after a Profile with their Manager, change a status in the cell |
| Profile page | all | `/profiles/:id` inside the app: header with status, Deactivate and **Delete** (Founder), Edit, **Looked after by** (with a hand-on button for the Founder and the team's Manager) and **Manager share** (the Founder edits it, Managers read it); a "Still to do" list; Approve / Reject for pending ones (Founder); personal details, platforms (one row each with its green or red dot; clicking a platform unfolds its status and rate, which the Founder edits there) and, for the Founder, addresses and banks (open, closed, primary). Edit shows the form on the page |
| Everyone's chats | the owner (`OWNER_EMAIL`) | `/chat/all`: every conversation in the system, the two people on each row, and the thread as a plain transcript — who said it, when and what, oldest first, older pages on request. Read only: no message box, no reactions, no read receipt, and a line on the page saying every chat opened is recorded in the audit trail. Reached by the eye button beside **New chat**, shown to the owner alone |
| Chat | all | Each chat row has a menu with **Clear chat history**. Messages can be deleted by their sender (a placeholder stays), carry pictures (paste, drop or attach; click to enlarge) and emoji reactions; an emoji picker sits by the message box. An arriving message raises a toast with an Open button unless that chat is already on screen, plus a browser notification when one is allowed. Chat list (search, unread counts, open task marker) beside the conversation; the thread loads 40 messages at a time as you scroll up or down and keeps at most 5 pages (200 messages) in memory, with "Jump to latest" while an older window is shown; New chat lists only people the rules allow. Live messages, "Seen", read-only when the other person is inactive. Founders and Managers open a message's menu to give it as a task (when `canGiveTask`); the taker gets "Mark done" on it and the giver "Confirm" once done |
| Tasks | all | Four views of the same list, chosen by tab and kept in the URL. **Execution** (the default) answers what to work on now: one row per task — Task, Owner, Start By, Complete By, Priority, Status — sorted by Start By, with the risk showing beside the status and "Waits for …" under a task held up by another. **Deadline** is the same rows sorted by Complete By. **Today** is everyone's started, unfinished work grouped by person, above a team-workload table (Active, Due today, Overdue, Blocked, Ready for review) for anyone who sees more than their own tasks. **Board** is the quadrants below. A row opens the task in a dialog with everything in it (§18): owner, the two dates with their own labels, the quadrant that sets the priority, description, expected deliverable, definition of done and what it waits for, with **Save & create another** for a batch. A deadline typed with no start date warns on the spot. Where the work stands is a dropdown on the owner's own rows — Not Started, In Progress, Blocked — and Blocked asks why before it is set |
| Task board | all | One board per person: your own first, then the people below you (every Associate for a Manager; everyone for the Founder). Each board is **four quadrants** — two columns, **Need action** and **Can wait**, and two rows, **Strategic** and **Non strategic** — each with its own count and its own order. Filters Active / Open / Waiting for confirmation / Completed / All. Each board has "New task" for that person — including your own, for a personal to-do, which has a single tick and is done the moment you tick it. A task is one line, with a coloured bar and tick boxes showing its state at a glance: the taker's tick, the giver's tick, what it says, who gave it and when, then reopen, delete and a link to the chat. Tasks are dragged by the handle on the left (mouse, touch or keyboard) into any of the four quadrants, or onto another quadrant of someone else's board to hand it to them; empty quadrants take a drop too, and the order is saved for everyone who sees that board. A new task, and any task given to you, starts in **Need action · Strategic**. **New task** at the top adds one for yourself, or for someone you pick. Boards with nothing in them start folded |
| Platforms | Founder, Manager | List + create/edit, sorted by priority |
| Team | Manager | Own Associates, create (with their share), deactivate; each card shows the Associate's portion of the Manager's share, which the Manager edits |
| Users | Founder | All users, create any role, with a **Pay** column (an Expert's hourly rate, an Associate's share) set in the create and edit dialogs; editing an Expert's rate can also price their finished calls that have none. Edit user has a **Sign-in** section (shown on request, audited: sign-in email, linked Google account, Unlink) and **Delete user** |
| Invoicing | Founder | Calls in `finished` and invoice stages with expected price and real income, batch transitions; paying asks for the real income per call (starting at the expected price). Rows say "No bank yet" for a Profile with no open bank account, and submitting invoices warns about calls without a rate or without a bank (`bankReady`) |
| Statistics | Founder, Manager, Associate | §6.14 |
| Audit | Founder | §6.16. A **Device** column (`US-desktop-01`) for the owner Founder alone; other Founders do not see the column |
| Notifications | all | List, mark read |
| Settings | all | Nickname (Founder-approved change **[Assumption]**, read-only for now), password, **Sign in with Google** status, **Signed-in devices** (sign out one or all others), photo upload or avatar, appearance, browser notifications (on/off, send a test); Experts also set their time zone |

### 9.2 Role landing pages

Every role lands on **Today** (their visible calls for the day). The Manager
also sees per-Associate counts by stage; the Founder also sees pending tasks and
the database size.

### 9.3 Behaviour

- Every list subscribes to `call:updated` and `call:deleted` and patches the
  TanStack Query cache; chat and task screens follow `chat:message`,
  `chat:message-updated`, `chat:cleared`, `chat:todo`, `chat:todos-reordered`
  and `chat:read`.
- The sidebar has no New call button; it shows the signed-in person at the
  top, and badges: calls waiting at my step on Calls (`GET /calls/waiting`),
  unread chat messages on Chat, and on Tasks the open tasks given to me plus
  done tasks I gave that wait for my confirmation.
- A tab left open across a deploy recovers by itself: a page whose files are
  gone reloads once, otherwise it shows "The app was updated — Reload".
- Transition buttons are disabled while a request is in flight; a 409 refreshes
  the Call and shows the reason.
- Time zones. Experts see every time in their own zone. Everyone else sees
  New York time (`America/New_York`), the team time. EDT and EST switch
  automatically with daylight saving, because zones are stored as IANA names,
  never as fixed offsets. Times are stored and sent in UTC. Every time input
  says which zone it uses.
- The calendar can show extra clocks beside the grid: team time for Experts,
  the Expert's zone for everyone else, and one client time zone. The client
  zone is a viewing aid only: remembered per browser, never saved on a call.
- Responsive layout: works at phone width in the browser as a fallback before
  the native app exists.
- Light and dark mode follow the system setting, with a toggle in the header.

---

## 10. Mobile application (Phase 2)

### 10.1 Scope

Same server, same `packages/shared` and `packages/api-client`. New UI only.

| Screen | Notes |
|---|---|
| Login | Token stored in expo-secure-store |
| My Calls | Role-scoped list, pull to refresh, live via socket |
| Call detail | Status, transition buttons, message thread |
| Notifications | List, tap to open Call |
| Settings | Password, log out, push toggle |

Creation and administration screens (Users, Platforms, Profiles) stay web-only
in Phase 2 **[Assumption]**.

### 10.2 Push notifications

Browser push is already live in the web app (§7.5). For the native app:

- On login, app requests permission, obtains an Expo push token, and calls
  `POST /devices`.
- `notify()` sends via Expo Push API for every device token of the recipient
  (enable with `PUSH_ENABLED=true`).
- Tapping a push deep-links to `call/{id}`.
- On logout the app calls `DELETE /devices/:token`.

### 10.3 Mobile-specific requirements

- Background socket disconnects are expected; the app refetches on foreground.
- Tokens refresh silently; a failed refresh returns to Login. `createApiClient`
  takes a `TokenStore` (expo-secure-store adapter) for this.
- Minimum targets: iOS 16, Android 10.

---

## 11. Non-functional requirements

| Area | Requirement |
|---|---|
| Latency | Status change visible to other participants within 1 second on a connected client |
| Scale | Designed for hundreds of users and tens of thousands of Calls; single Postgres instance |
| Availability | Single region; daily database backups |
| Observability | Structured JSON logs (pino), request ids (`X-Request-Id`), health endpoint `/healthz` |
| Timezones | UTC in storage and transport; display per §9.3; repeating availability stored as wall-clock rules in the Expert's IANA zone |
| Accessibility | Keyboard navigable web UI, sufficient contrast |
| Browser support | Last two versions of Chrome, Edge, Firefox, Safari |

---

## 12. Development and deployment

### 12.1 Local setup

```
pnpm install
docker compose up -d          # Postgres 16 on :5432 (god + god_testsuite)
cp apps/api/.env.example apps/api/.env
pnpm --filter api db:migrate
pnpm --filter api db:seed     # founder + sample users, platforms, profiles
pnpm dev                      # api on :4000, web on :5173
```

### 12.2 Environment variables (api)

| Name | Example |
|---|---|
| DATABASE_URL | postgresql://god:god@localhost:5432/god |
| TEST_DATABASE_URL | postgresql://god:god@localhost:5432/god_testsuite |
| JWT_SECRET | 32+ random bytes |
| ACCESS_TOKEN_TTL | 15m |
| REFRESH_TOKEN_TTL | never (default; or a duration such as 30d) |
| CORS_ORIGINS | http://localhost:5173,http://192.168.0.10:5173 |
| PORT | 4000 |
| HOST | 0.0.0.0 |
| PUBLIC_API_URL | http://localhost:4000 |
| LOGIN_RATE_LIMIT | 5 |
| OWNER_EMAIL | andrewlong0808@gmail.com (the Founder who owns the system; only they see the device on an audit entry) |
| COOKIE_SECURE | true in production |
| LOG_LEVEL | info |
| TRUST_PROXY | 1 (2 behind Vercel → Render) |
| VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY | Browser push keys (`npx web-push generate-vapid-keys`); empty = push off |
| VAPID_SUBJECT | mailto:admin@god-system.app |
| DB_DUMPS_ENABLED | true (false turns the nightly dump off) |
| GOOGLE_CLIENT_ID | `…apps.googleusercontent.com` from Google Cloud → Google Auth Platform → Clients; empty = Google sign-in off |
| SEED_FOUNDER_EMAIL, SEED_PASSWORD | founder@god.local, Password123! |
| PUSH_ENABLED, EXPO_ACCESS_TOKEN | (Phase 2) |

Web: `VITE_API_URL` (empty = same origin; Vite proxies `/api` and `/socket.io` in development).

### 12.3 Seed data

One Founder (`founder` / configured password), two Managers (atlas, beacon),
four Associates (pixel, sprout, mango, comet), three Experts, five Platforms,
ten approved Profiles (with personal details and platform statuses, one of
them banned on a platform) plus one pending and one rejected Associate
submission, and a dozen Calls in every status with history; started and
finished calls have Ninja links and real durations. Each Profile has a rate per
platform (around the 1000 default). The Experts live in
Seoul (ember), London (flint) and New York (quill), and each has repeating
availability starting from the current week, plus some time off, so the
calendar has something to show.

The seed's Platforms are made up, for a demo database. The **real expert
networks** the company works with are a separate list, kept in
`apps/api/scripts/import-platforms.ts` and applied with `pnpm --filter @god/api
platforms:import` (a plan by default; `APPLY=1` writes). It corrects a network
already in the database in place — keeping the calls and registrations pointing
at it — and adds the rest, so it can be run again after the list changes. A
network whose country or website could not be confirmed is stored as `XX` and
as an `example.com/needs-verification/…` address, and the plan lists those every
run, to be corrected on the Platforms page.

### 12.4 Testing

- Unit (`packages/shared`, 1481 tests): `canTransition` against every (role,
  from, to) combination with and without the relationship; who may chat with
  whom; what Experts see of invoicing; repeat expansion
  for each repeat form, checked against a day-by-day reference, including
  daylight saving changes; block validation; edit scopes.
- API (`apps/api`, 409 tests): transition endpoint returns 403 for wrong role,
  409 for wrong edge, 200 and a history row for valid moves; confirmation,
  rescheduling requests, Ninja link and duration rules; Experts never seeing
  invoicing, rates, bank data or invoice figures; platform rates (Founder-only,
  optional, the Founder's alone); Profile deactivation; the research data link reaching only
  the Founder and the Expert; per-call rates; presence per role; database dumps
  (contents, retention, Founder-only access); Profile submissions, personal details, founder-only address
  and platform statuses; chat rules, unread counts, to-dos and their done
  replies; browser push subscriptions and delivery (push service mocked);
  per-Call messages switched off; anonymity check
  that no response contains an email; time zone permissions; schedule block
  edit scopes; calendar privacy (Associates see other Associates' calls only
  as busy time); double booking rejected with 409; auth rotation and reuse
  detection; rate limiting; database constraints; sessions and the audit
  trail; Google sign-in (token check mocked); tasks, the task board and
  retention; statistics; chat pictures, deletion, reactions and history
  clearing; deleting users, Profiles and Calls; closed bank accounts; who is
  paid what (rates fixed at finish, shares at payment, who sees which line,
  marking paid, the Finance tab's scope and totals); Profiles looked after by
  an Associate; handing tasks on; the research step hidden from Associates and
  Managers (status, history, filters, notifications); meeting details; monthly
  payment cycles (closing pays everyone owed, records the month, starts from
  zero, locks its payments); Associates' shares as a portion of the Manager's,
  set by their own Manager; who may set platform statuses.
- CI runs `pnpm typecheck` across every package (including test files), then
  the shared and API tests against a Postgres service, then both builds.
- API tests run against a separate local database, `god_testsuite`, migrated
  with `prisma migrate deploy` at the start of each run. They refuse to run
  against a non-local host.
- E2E (web, Playwright): Associate schedules → Expert confirms and finishes
  (duration only) → Founder invoices, with a Manager's browser observing
  live updates.

### 12.5 Deployment

**[Implementation]** Live setup:

- Web on **Vercel**, built from the repo root with `vercel.json`: only the web
  workspace is built, `/api/*` and `/socket.io/*` are rewritten to the API, and
  every other path falls back to `index.html`. The browser only ever talks to
  the Vercel domain, so the refresh cookie stays first-party. Use the
  production domain; one-off deployment URLs sit behind Vercel's login.
- API on **Render** from `render.yaml` (Node 22, pnpm build, `prisma migrate
  deploy` on start, health check `/healthz`). Environment: `DATABASE_URL`,
  `JWT_SECRET` (generated), `CORS_ORIGINS` and `PUBLIC_API_URL` (both the
  Vercel URL with `https://`), `COOKIE_SECURE=true`, `TRUST_PROXY=2`, the
  VAPID keys and `GOOGLE_CLIENT_ID`. Migrations land in the shared database
  before the API redeploys, so they must only add things; press Manual Deploy
  when auto-deploy lags. Auto-deploy needs Render's GitHub app to have access to the
  repository. On the free plan the API sleeps after about 15 minutes idle.
- Database: **Aiven** PostgreSQL, database `god`, shared by production and
  local development.

Container alternative:

- API: single container (`apps/api/Dockerfile`) behind a reverse proxy with TLS; runs `prisma migrate deploy` on start.
- Web: static build served by nginx (`apps/web/Dockerfile`), which also proxies `/api` and `/socket.io`.
- Postgres: managed instance or container with volume + backups.
- `docker-compose.prod.yml` wires the three together on one host.
- Socket.IO with a single API instance needs no adapter; add the Redis adapter
  when scaling to more than one instance.
- CI (`.github/workflows/ci.yml`): typecheck, unit tests, API tests against a Postgres service, builds.

---

## 13. Roadmap

| Phase | Deliverable |
|---|---|
| 1a | Monorepo, Postgres schema, migrations, seed, auth, shared transition rules — done |
| 1b | Calls API with transitions, history, notifications, Socket.IO — done |
| 1c | Web app: all screens in §9 — done |
| 1d | Tests in §12.4, deployment — done |
| 1e | Call confirmation and feedback, Profile details and platform statuses, chat and to-dos, browser push — done |
| 1f | Sessions and audit trail, expected price and real income, tasks with confirmation, statistics, Google sign-in, Managers with every Associate function, chat pictures and reactions, Profile pages, deleting users, Profiles and Calls — done |
| 2 | Expo mobile app (§10), push notifications |
| 3+ | See §14 |

---

## 14. Future extensions

- `cancelled` and `no_show` statuses (§4.5).
- File attachments on Calls (invoice PDFs, call notes).
- Recommend Experts on the New Call form from the chosen time and each
  Expert's availability. The form keeps Expert as the last field for this, and
  already lists free Experts first.
- Calendar sync (ICS feed per user, Google Calendar).
- More analytics: cycle time per stage (per-Platform, per-Profile and
  per-Associate figures exist in Statistics).
- Group chats; typing indicators and file attachments in chat (pictures exist).
- "View as": the Founder sees the app exactly as another user does, read-only
  and audited, in its own tab (agreed, not built yet).
- Turning per-Call message threads back on (`FEATURES.messages`).
- Multi-currency invoice totals and export to CSV.
- Two-factor authentication.
- Multi-tenant (separate organisations) if the system is offered to others.
- Horizontal scaling: Redis adapter for Socket.IO, read replicas.
- Nickname change requests approved by the Founder (§15.1).

---

## 15. Open questions

1. Can an Associate change their own nickname freely, or must the Founder
   approve? (Currently **[Assumption]**: Founder approves; in v1 only the
   Founder or Manager edits nicknames.)
2. Should Managers be able to perform execution-stage overrides (ongoing,
   finished) when an Expert is unresponsive? (Currently: Founder only.)
3. Should Experts see the Profile's LinkedIn URL? (Currently: they see it,
   with the personal details and history but not platform statuses.)
4. ~~Is `invoice_amount` entered per Call?~~ Replaced: the expected price is
   computed (rate × real duration) and the Founder enters the real income per
   Call when paying it.
5. Does one Call ever involve more than one Expert?
6. ~~Should Managers add Profiles?~~ Yes, for review like Associates. Platform
   statuses and rates stay with the Founder.
7. ~~Can a done to-do be reopened?~~ Yes: the giver reopens done or completed tasks.

---

## Appendix A. Glossary

| Term | Meaning |
|---|---|
| Call | A single expert-consultation engagement tracked from scheduling to payment |
| Platform | The external service where the Call takes place or was sourced |
| Profile | The external person the Expert speaks with |
| Stage | Group of statuses owned by one role: Scheduling, Execution, Invoicing |
| Override | A higher role performing a transition normally owned by another role |
| Participant | The Associate (or Manager running it), Expert, the Associate's Manager, and Founder for a given Call |
| Expected price | Rate × the call's real duration; what a finished call should bring in |
| Real income | What actually reached the bank for a call, entered by the Founder when paying it |
| Manager share | The Manager's percent of a call's real income (15 by default, per Profile), including the Associate's part |
| Payout | One person's pay for a call: the Expert's (rate × real duration) or a share of the real income |
| Research data | The research the Expert reads to prepare for a call; a link the Founder adds (`researchLink`) before marking the step "Research data ready" |
| Meeting details | How to join the platform's meeting (link, passcode…), on the call for everyone on it |
| Payment cycle | The month between two payment days; closing it pays everyone the Founder owes and keeps the month on record |
| Confirmed | The Expert has confirmed they are available for the scheduled time |
| Ninja link | The VDO.Ninja meeting link the Expert adds when a call starts |
| Platform status | A Profile's standing on an expert network platform: not registered, registered or banned |
| Conversation | A one-to-one chat between two users |
| Task (to-do) | Work given by someone above you (Founder → anyone, Manager → any Associate), from a chat message or New task. The taker ticks it done, the giver confirms it: completed, and it stays in view for a week |

## Appendix B. Change log

| Date | Change |
|---|---|
| 2026-09-11 | Initial specification |
| 2026-09-13 | Profile approval workflow; call project details and platform associate; fixed call durations; generated avatars; role badges with icons and a role banner |
| 2026-09-14 | Avatar catalog (120 avatars, one style per audience) chosen on user creation, in Settings and on profiles; only the founder adds profiles; scheduled time, platform associate and project details required on calls |
| 2026-09-14 | Calendar: Expert availability and time off as repeating rules with this / following / all edits; Expert time zones with New York as team time; client time zone as a calendar-only clock; busy blocks that hide other Associates' calls; double booking blocked in the database; duration required on new calls; `ends_at` on calls |
| 2026-09-14 | Availability hidden in the web app to keep it simple: Experts add only time off, and the New Call form no longer checks working hours. The API, database and tests keep full availability support; `AVAILABILITY_ENABLED` in `apps/web/src/lib/features.ts` turns it back on |
| 2026-09-14 | "All experts" calendar view for Founder, Manager and Associate: one column and color per Expert, a "who is free" list when selecting a time, and `GET /calendar/experts`. The New Call form links to it |
| 2026-09-14 | The database now refuses calls without a time, a duration, project details or a platform associate |
| 2026-09-14 | Phase 1 implemented. Material UI 7 instead of Tailwind; `permissions`, `manager`, `projectDetails`, `platformAssociateName` and the Expert's `timeZone` on Call responses; `GET /dashboard`; per-viewer `call:updated` via user rooms; `session:revoked` socket event; refresh token families; login rate limit counts failures only; Playwright E2E; Dockerfiles, production compose and CI |
| 2026-09-15 | Founder dashboard rebuilt around today (ongoing / coming up / finished), pending tasks (invoices to submit, Profiles needing a bank) and database size; Profile banks (several per Profile, one primary, Founder-only); photo uploads for users and Profiles; calmer visual design (neutral palette, dot status pills, no banner) |
| 2026-09-15 | Calls: the Expert adds a Ninja link to start and enters the real duration and a 1–5 rating with feedback to finish; per-Call messages switched off; platform links hidden. Profiles: date of birth, gender, nationality, location, education and career history; status per expert network platform (default not registered) with a Founder table view; Experts can open the Profiles of their calls |
| 2026-09-15 | Associates can add Profiles again; they stay pending until a Founder approves, and Founders are notified (`profile.submitted`) |
| 2026-09-15 | New `confirmed` status: the Expert confirms a scheduled time before the call can start; Experts can request rescheduling with a reason and are reminded to update their calendar; moving a confirmed call's time needs a new confirmation. Founder-only current address and bank details on the Profile details view |
| 2026-09-15 | Deployed: web on Vercel (rewrites to the API), API on Render (`render.yaml`), Aiven database; `TRUST_PROXY`; sockets start with long-polling |
| 2026-09-15 | One-to-one chat (Founder with anyone, same role, Associates with Managers) with unread counts and read receipts; Founders turn chat messages into to-dos, and marking one done replies in the chat; Chat and To-dos pages with sidebar badges |
| 2026-09-15 | Browser push notifications (Web Push + service worker) for chat messages and notifications, with Settings controls and an installable web app manifest |
| 2026-09-15 | Experts no longer see invoicing: invoiced calls show as finished, without amounts, invoicing history or invoicing notifications |
| 2026-09-15 | Each Profile has a rate per expert network platform (USD per hour, default 1000), set by the Founder and hidden from Experts; finishing a call now asks the Expert only for the real duration |
| 2026-09-16 | Presence (online / away / offline with "last seen") for everyone you may chat with. Nightly database dumps, kept for 7 days, with Run now and Download on the Founder dashboard. Profiles can be deactivated: Founder-only visibility and unbookable. A platform rate is now required only when a Profile is marked registered and stays editable, and one Call can carry a special rate. New `gpt_link` on a Call, readable only by the Founder and the Expert. Associates can change the Expert for the whole scheduling stage. Required fields marked on the New Call form |
| 2026-09-15 | Chat narrowed: no chats between Associates or between Experts. Experts chat only with Founders; Managers with Founders, Managers and Associates; Associates with Founders and Managers. Older chats that are no longer allowed are read-only |
| 2026-09-16 | Sessions never expire and record device, browser, OS, IP and country, with "Signed-in devices" in Settings and the Founder able to end anyone's; a full audit trail of changes and sensitive reads (Founder's Audit page); a rate is required before invoicing; links must be http(s) |
| 2026-09-16 | Expected price (rate × real duration) and real income (entered when paying) replace the invoice amount and currency |
| 2026-09-16 | Profiles: email and phone for everyone but Experts, several labelled addresses (Founder only), and an onboard date defaulting to the approval date |
| 2026-09-16 | Tasks: Founders give tasks to anyone, Managers to Associates on their own team, from a chat message or with New task. The taker marks a task done, the giver confirms it (completed, hidden from the default list) or reopens it |
| 2026-09-16 | Statistics: by Associate (weekly, bi-weekly, monthly calls and potential money; Founders see all, Managers their team, Associates themselves), by Profile for the Founder (onboard date, status incl. deactivated, email, bank, total income) and Finance for the Founder (expected vs real income per period, platform and Profile, and the gap) |
| 2026-09-16 | Chat threads load older and newer messages automatically while scrolling and keep only a 200-message window in memory (`after` cursor on chat messages) |
| 2026-09-17 | Sign in with Google: Google accounts link to existing users by their sign-in email the first time and by Google's account id afterwards; the Founder sees and edits a user's sign-in email and can unlink Google |
| 2026-09-17 | Managers have every Associate function: they run calls themselves (as the call's Associate), add profiles for review, and see their own row in Statistics |
| 2026-09-17 | Chat: delete your own messages for both people (a placeholder stays), paste, drop or attach pictures (shrunk in the browser, stored in the database), an emoji picker, and emoji reactions |
| 2026-09-17 | Founders can delete a user account: everything personal is erased and the nickname freed, while the person's calls, messages and history stay as a removed user |
| 2026-09-17 | Tasks are shown as one panel per person (your own first, then the people below you) instead of "Given by me" and "Assigned to me" tabs |
| 2026-09-17 | A task is one compact line with two tick boxes (the taker's and the giver's); the giver can delete a completed task |
| 2026-09-17 | Managers oversee every Associate (calls, calendar, statistics, tasks); Managers and Associates see financial statistics for the calls they can see; Managers and Experts can chat; presence is blue on the platform and grey with a last-seen time away from it; calendar blocks carry a status badge; completed tasks stay in view for a week |
| 2026-09-18 | Chat histories can be erased for both people; one presence dot per avatar (blue on the platform, grey away from it); no New call button in the sidebar, but a badge for calls waiting on you; calls cannot be booked in the past and calls being scheduled show on everyone's calendar; the call panel shows the platform, how soon it starts and its money; Profiles are one table with a Pending column, platform dots and their own page; bank accounts can be closed, and invoicing warns when a Profile has none open |
| 2026-09-18 | Calls read as how soon they are ("in 13 hours") with the date beside them; a finished call shows its expected price, or that it still needs a rate, and its real income once paid; an arriving chat message raises a toast; platform rows on a profile keep a name column with a status dot |
| 2026-09-18 | Call times read in plain words everywhere: "in 13 hours" over "Tomorrow 11 AM · 45 min"; the exact date and range stay in the tooltip |
| 2026-09-18 | A tab left open across a deploy recovers by itself: a page whose files are gone reloads once, and otherwise shows "The app was updated — Reload" |
| 2026-09-18 | Founders can delete a Profile: gone entirely if it never had calls, otherwise erased and hidden with its calls and income kept. Closed bank accounts no longer satisfy the dashboard's "Add bank" task |
| 2026-09-19 | Founders can delete a Call for good, with its status history, messages and notifications |
| 2026-09-19 | Spec brought up to date (v1.4): sessions and audit trail sections, money on calls, new tables (ProfileAddress, AuthIdentity, AuditLog, ChatImage, ChatReaction), task and chat rules, screens. Managers now list every Associate, so they can pick any of them for a call |
| 2026-09-20 | A call can be **cancelled** before it starts by whoever runs it, any Manager or the Founder: terminal, off the calendar, the Expert's slot freed, no income. Experts never cancel |
| 2026-09-20 | Anyone can put a task on their own panel; ticking it finishes it at once. Tasks are dragged into the order their panel should keep, and everyone sees that order |
| 2026-09-20 | The call panel names its money in a field of its own: Expected income once finished, Real income once paid. The Profiles table shows the priority-one platform's status by name and unfolds every platform on click. Submitting an invoice from the call page warns when the Profile has no open bank account. Reading the audit trail is no longer written to the audit trail |
| 2026-09-21 | **Who is paid what**: Experts have an hourly rate and Associates a share, set by the Founder; each call keeps the Expert's rate from when it finished and the shares from when it was paid to bank. The Founder pays the Expert and the Manager (15% of real income by default, per Profile), the Manager passes the Associate's part on. The Calls page has two tabs, In progress and Finance: each person's own money on the calls that took place, with totals, and rows the Founder and Managers select and mark paid. Profiles are looked after by an Associate, handed on by the Founder or within a Manager's team. Platform statuses are green and red dots, with the rate only on click. Calls can be cancelled from the list; the deep search data link leads the call page while it is being prepared, and the dashboard lists booked calls still without it. Tasks can be dragged onto another person's panel, and New task sits at the top of the page. Old "read the audit trail" entries were cleared |
| 2026-09-21 | Rebranded as **Silver Horizon**: logo in the sidebar, the banner on the sign-in page, new favicon, app and notification icons, navy as the primary colour. The Ninja link of a call now reaches only the Founder and the Expert |
| 2026-09-25 | **Start By and Complete By** on every task, kept apart everywhere: an **Execution** view sorted by when work should begin (the default) and a **Deadline** view sorted by when it must be finished, plus a **Today** view with the team's workload. Five statuses — Not Started, In Progress, Blocked (which must say why), Ready for Review, Completed — an expected deliverable and a definition of done, what a task waits for, editing after it was given, overdue and at-risk indicators, and P1/P2/P3 read off the quadrant. From the Task Management System PRS v1.0 |
| 2026-09-24 | The owner Founder (`OWNER_EMAIL`) can read **everyone's chats** at `/chat/all` — reading only, leaving no read receipt, and recorded in the audit trail |
| 2026-09-24 | The **47 expert networks** the company works with are in the database, grouped into four priorities. The **Platform status** tab shows every Profile — no review banner, no status filter — with the **Manager** in place of the Associate and a filter by Manager, and one narrow column per platform, shown a **priority at a time** so the table fits a screen |
| 2026-09-24 | The task board is **four quadrants** — Need action / Can wait across, Strategic / Non strategic down — and a task is dragged into any of them, on any board; a new task, and any task given to you, starts in Need action · Strategic. **Meeting details are required before a call is scheduled**, asked for in the step itself. Each browser is remembered as a **device** (`US-desktop-01`) and named in the audit trail, where only the owner Founder (`OWNER_EMAIL`) can see it |
| 2026-09-22 | A new step, **Research data ready**, which the Founder takes between the Expert's confirmation and the call (it needs the research data link); Associates and Managers never see it. "Deep search" is now "research data". Calls carry **meeting details** (link, passcode…) that whoever runs the call adds and everyone on it reads. Money: everyone is paid **monthly** — the Founder closes each payment cycle by paying everyone they owe, and the month is kept on record (Payment records tab); the Founder's Finance panel shows the cycle's income, what was paid out and the balance. An Associate's share is now a portion of their Manager's share (default 50%), set by the Founder or their own Manager; Associates see their Manager's share and their part, never a call's income or rate. The call panel shows both expected (rate × minutes) and real income. Profiles have a **Platform status** tab, and the Profile's Associate and their Manager may set platform statuses (a rate is no longer required to register; rates stay the Founder's) |
