# God System — Project Specification

Version 1.3 · 2026-09-16 · Status: Phase 1 implemented, deployed

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
- Accounting integration (the invoice stages are status tracking only).

---

## 2. Users and roles

| Role | Description | Managed by |
|---|---|---|
| **Founder** | Owner of the system. Full access. Handles invoice stages. Creates Managers. | — |
| **Manager** | Manages a team of Associates. Oversees all Calls of those Associates. | Founder |
| **Associate** | Creates and schedules Calls. Owns the scheduling stages. | Manager |
| **Expert** | Confirms and performs the Call. Owns the execution stages. Never sees invoicing. | Founder |

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
  refresh responses, which describe the caller).
- There is no real-name field anywhere in the schema.
- Chat messages, to-dos, status history entries, and assignments display
  nickname + role only.
- **[Implementation]** Call payloads also include the Expert's IANA time zone
  so clients can show the Expert's local time (§9.1 New Call).

### 2.3 Permission matrix

| Action | Founder | Manager | Associate | Expert |
|---|---|---|---|---|
| Create Manager | ✓ | | | |
| Create Associate | ✓ | ✓ (own team) | | |
| Create Expert | ✓ | | | |
| Deactivate user | ✓ | ✓ (own team) | | |
| Delete user | ✓ (not themselves) | | | |
| Create / edit Platform | ✓ | ✓ | | |
| Add Profile | ✓ (approved at once) | ✓ (pending until a Founder approves) | ✓ (pending until a Founder approves) | |
| Edit Profile | ✓ | own pending or rejected submission | own pending or rejected submission (sends it back for review) | |
| View Profile details | all | shared + own team's submissions | shared + own submissions | Profiles of assigned Calls, without platform statuses |
| Set a Profile's status and rate on a platform | ✓ | | | |
| Deactivate a Profile / see deactivated ones | ✓ | | | |
| See / edit a Profile's current address and banks | ✓ | | | |
| Upload own photo | ✓ | ✓ | ✓ | ✓ |
| Upload a Profile photo | ✓ | | | |
| Approve / reject a pending Profile | ✓ | | | |
| Choose own avatar (from own role's set) | ✓ | ✓ | ✓ | ✓ |
| Create Call | ✓ | ✓ | ✓ | |
| View Call | all | own team's + own | own | assigned |
| Reassign Associate on a Call | ✓ (to any Associate or Manager) | ✓ (own team's and own calls, to self or own team) | | |
| Reassign Expert on a Call | ✓ | ✓ (own team + own) | ✓ (own, whole scheduling stage) | |
| Set scheduling statuses | override | override (own calls: ✓) | ✓ | request rescheduling only |
| Confirm a scheduled Call | override | | | ✓ |
| Set execution statuses | override | | | ✓ |
| Set invoice statuses | ✓ | | | |
| See invoice statuses and amounts | ✓ | ✓ (own team) | own | |
| See a Profile's platform rates | ✓ | ✓ | ✓ | |
| Set a special rate for one Call | ✓ | ✓ (own team + own) | own | |
| Set the Call's GPT link | ✓ | | | |
| Read the Call's GPT link | ✓ | | | ✓ (assigned) |
| See who is online (§7.6) | people they may chat with | same | same | same |
| Run / download a database dump | ✓ | | | |
| Post message in Call thread (switched off, §6.5) | ✓ | ✓ | ✓ | ✓ |
| Chat one-to-one (§6.11) | anyone | Founders, Managers, Associates | Founders, Managers | Founders only |
| Give tasks (chat message or New task) | ✓ anyone | ✓ own-team Associates | | |
| View audit history | ✓ | ✓ (own team) | own | assigned (without invoicing steps) |

**[Implementation]** Managers have every Associate function: a Call's Associate may be a
Manager, who then runs it exactly like an Associate (no overrides on their own Call), sees
it in their lists, calendar and statistics, and may hand it to their team.

"override" means the role may perform the transition on behalf of the normal
owner. Every override is recorded in the status history with the actor.

**[Assumption]** Managers may override scheduling statuses for their
Associates' Calls. Founder may override anything.

**[Implementation]** Field-level edit rules, computed server-side and returned
as `permissions` on every Call:

- `edit` (time, duration, platform, platform associate, project details,
  notes): the call's Associate, their Manager or the Founder while the call is
  in the scheduling stage; the Founder at any stage.
- `reassignAssociate`: Founder, or the Manager of the call's Associate.
- `reassignExpert`: Founder, the Manager of the call's Associate, or the call's
  Associate — for as long as the call is in the scheduling stage (through
  `confirmed`), which is where the Associate owns the status. The Expert still
  cannot be removed from a call that is `scheduled` or later.
- `editInvoice`: Founder.
- `editGptLink`: Founder.
- `editRate` (the special rate for one call): whoever owns scheduling — the
  call's Associate, their Manager, or the Founder.

**[Implementation]** Experts never see invoicing. The server shows them
`invoice_submit`, `invoice_approve` and `process_to_bank` calls as `finished`
(in call payloads, lists, the calendar, dashboard counts and socket updates),
sends `invoiceAmount`/`invoiceCurrency` as null, leaves invoicing steps out of
their status history, treats a `finished` filter as including invoiced calls,
and does not notify them about invoicing transitions or invoice edits. The web
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
| email | text, unique | Login only, never exposed |
| password_hash | text | argon2id |
| is_active | boolean | Deactivated users cannot log in |
| avatar_id | text → Avatar | Must be from the avatar set for the user's role |
| photo_id | uuid → Photo, nullable, unique | An uploaded picture, shown instead of the avatar |
| last_seen_at | timestamptz | Last time they were connected; shown as "last seen" when offline (§7.6) |
| time_zone | text (IANA name) | Default `America/New_York`. Only meaningful for Experts: where they live, e.g. `Asia/Seoul`. Everyone else works on New York time (§9.3) |
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
| current_address | text, nullable | Founder only: never returned to other roles, and ignored when others send it |
| avatar_id | text → Avatar | Must be from the profile avatar set |
| photo_id | uuid → Photo, nullable, unique | Uploaded by the Founder |
| status | enum: pending, approved, rejected | Profiles added by a Founder are approved at once; Associate submissions start pending until a Founder approves or rejects them |
| is_active | boolean | Default true. A deactivated Profile is listed for Founders only and cannot be booked (409 `profile_not_approved`); its existing Calls carry on |
| created_by | uuid → User | Who added it |
| reviewed_by | uuid → User, nullable | Founder who approved or rejected |
| reviewed_at | timestamptz, nullable | |
| rejection_reason | text, nullable | Required when rejected |
| created_at, updated_at | timestamptz | |

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
| associate_id | uuid → User (role associate) | |
| expert_id | uuid → User (role expert), nullable | Required before `scheduled` |
| scheduled_at | timestamptz | Required. Can be moved, never cleared |
| duration_minutes | integer | Required. One of 15, 30, 45, 60 |
| ends_at | timestamptz | Kept by a database trigger: scheduled_at + duration. Used to prevent double booking |
| notes | text | Internal notes |
| project_details | text | Required, never blank. The project brief from the platform |
| platform_associate_name | text | Required, never blank. The platform's own staff contact, not our associate |
| ninja_link | text, nullable | Meeting link the Expert must add when starting the call |
| gpt_link | text, nullable | Research link, set by the Founder. Sent only to the Founder and the Expert |
| rate_override | numeric(12,2), nullable | A special rate (USD per hour) for this Call only; falls back to the Profile's platform rate. Never sent to Experts |
| actual_duration_minutes | integer, nullable | Entered by the Expert when finishing; the booked `duration_minutes` (and the calendar slot) stay unchanged |
| rating | integer 1–5, nullable | From an earlier finish form that asked "How did the call go?". No longer asked for; kept for old calls |
| feedback | text, nullable | The note that went with that rating |
| invoice_amount | numeric(12,2), nullable | Founder stage. Never shown to Experts |
| invoice_currency | text (ISO 4217), nullable | |
| created_by | uuid → User | |
| created_at, updated_at | timestamptz | |

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
| type | text | call.status_changed, call.assigned, call.created, call.updated, call.message, todo.assigned, todo.done, todo.completed, todo.reopened, profile.submitted, profile.approved, profile.rejected |
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
| body | text | Never blank (check constraint), at most 5000 characters |
| kind | enum: text, todo_done | `todo_done` is the reply posted when a to-do is marked done |
| reply_to_id | uuid → ChatMessage, nullable | For `todo_done`: the to-do's message |
| created_at | timestamptz | |

#### Todo

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| message_id | uuid → ChatMessage, nullable, unique | The chat message the task was made from (null for a standalone task) |
| title, details | text, nullable | A standalone task's title (required when there is no message) and details |
| confirmed_at | timestamptz, nullable | When the giver confirmed it; set exactly when status = completed |
| conversation_id | uuid → Conversation | |
| assignee_id | uuid → User | The other person in the chat |
| created_by | uuid → User (Founder) | |
| status | enum: open, done | `done_at` is set exactly when done (check constraint) |
| done_at | timestamptz, nullable | |
| done_note | text, nullable | The assignee's note, also the body of the reply |
| done_message_id | uuid → ChatMessage, nullable, unique | The `todo_done` reply |
| created_at, updated_at | timestamptz | |

#### ProfilePlatformStatus rates

Each Profile × Platform row also carries `rate`: what that Profile is paid per
hour on that platform, in USD. It is **empty until the Founder sets one** and is
**required to mark the Profile `registered`** on that platform (400 with a
`rate` issue otherwise; a database check backs it up). It stays editable
afterwards, so marking a Profile registered is never a one-way decision. Only a
Founder changes it, and Experts never receive it (their `platformStatuses` is
null).

A Call may also carry `rate_override` for a project priced away from the
standard rate; the call's Associate, their Manager or the Founder sets it.

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
| expires_at | timestamptz | |
| revoked_at | timestamptz, nullable | |
| replaced_by | uuid, nullable | The token issued by the rotation |

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
ChatMessage  1 ── 0..1 Todo
User         1 ── * Notification
User         1 ── * DeviceToken
User         1 ── * WebPushSubscription
```

### 3.3 Database constraints

- All foreign keys enforced. Deleting a Platform, Profile, or User referenced
  by a Call is rejected; use deactivation instead.
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
  `calls_invoice_amount_nonnegative`, `calls_invoice_currency_format`,
  `calls_rating_range` (1–5), `calls_actual_duration_positive`,
  `conversations_ordered_pair`, `chat_messages_body_present`,
  `todos_done_at_when_done`, `profile_platform_statuses_rate_when_registered`,
  `calls_rate_override_nonnegative`.

---

## 4. Call status workflow

### 4.1 Statuses

| Status | Stage | Owner |
|---|---|---|
| on_scheduling | Scheduling | Associate |
| scheduled | Scheduling | Associate |
| confirmed | Scheduling | Expert |
| on_rescheduling | Scheduling | Associate or Expert |
| ongoing | Execution | Expert |
| finished | Execution | Expert |
| invoice_submit | Invoicing | Founder |
| invoice_approve | Invoicing | Founder |
| process_to_bank | Invoicing | Founder |

A new Call starts in `on_scheduling`: tentative, the Expert is optional and the
Expert's time is not blocked. `on_rescheduling` is a booked call sent back: the
Expert is required and the old slot stays blocked until it is scheduled again.

### 4.2 Allowed transitions

```
on_scheduling ──(Associate)──► scheduled
scheduled ──(Expert)──► confirmed
scheduled ──(Associate or Expert)──► on_rescheduling
confirmed ──(Associate or Expert)──► on_rescheduling
on_rescheduling ──(Associate)──► scheduled
confirmed ──(Expert)──► ongoing
confirmed ──(Expert)──► finished
ongoing ──(Expert)──► finished
finished ──(Founder)──► invoice_submit
invoice_submit ──(Founder)──► invoice_approve
invoice_approve ──(Founder)──► process_to_bank
```

Rules:

- Ownership passes with the stage: once `scheduled`, the Associate can no
  longer move the Call forward, only back to `on_rescheduling`.
- The Expert confirms a scheduled time (`confirmed`: they are available and
  will take the call) before the call can start or finish.
- Either the Associate or the Expert can send a scheduled or confirmed call
  back to `on_rescheduling`; neither counts as an override. An Expert must give
  a reason (400 without a comment), and the web app first reminds them to
  update their calendar so the Associate can find their new availability.
- Changing the time or duration of a `confirmed` call moves it back to
  `scheduled` (with a history row and notifications): the Expert confirms again.
- Moving to `ongoing` requires a `ninjaLink` (a URL). Moving to `finished`
  requires `actualDurationMinutes` (1–600), and nothing else: the Expert only
  says how long the call took. Missing or invalid values are 400 with field
  issues.
- Once `ongoing` or `finished`, the Associate has no transitions. Only the
  Founder may act after `finished`.
- `process_to_bank` is terminal.
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
  { from: 'confirmed',       to: 'ongoing',         roles: ['expert', 'founder'] },
  { from: 'confirmed',       to: 'finished',        roles: ['expert', 'founder'] },
  { from: 'ongoing',         to: 'finished',        roles: ['expert', 'founder'] },
  { from: 'finished',        to: 'invoice_submit',  roles: ['founder'] },
  { from: 'invoice_submit',  to: 'invoice_approve', roles: ['founder'] },
  { from: 'invoice_approve', to: 'process_to_bank', roles: ['founder'] },
];

export function canTransition(role, from, to, ctx): boolean
```

`ctx` carries the relationship check: the Associate must be the Call's
associate, the Expert must be the Call's expert, the Manager must manage the
Call's associate. The server enforces this function; clients use it only to
decide which buttons to render. Each edge also has its normal owners
(`EDGE_OWNERS`; rescheduling belongs to both the Associate and the Expert), and
anyone else allowed is recorded as an override.

**[Implementation]** Error precedence on `POST /calls/:id/transition`: a call
the user cannot see is 404; an edge not in the table is 409
`invalid_transition`; a valid edge the user may not take is 403; entering
`scheduled` without an Expert is 409 `expert_required`.

### 4.4 Side effects of a transition

Every successful transition, in one database transaction (with the call row
locked `FOR UPDATE`):

1. Updates `calls.status`.
2. Inserts a `call_status_history` row.
3. Stores the step's extra fields: `ninjaLink` for `ongoing`;
   `actualDurationMinutes` for `finished`.
4. Creates `notifications` for every other participant of the Call
   (associate, expert, associate's manager, founder), except that the Expert
   is not notified about invoicing steps.
5. After commit, emits `call:updated` and `notification:new` (§7.3) and sends
   browser push notifications (§7.5).

### 4.5 Proposed future statuses (not in v1)

- `cancelled` — reachable from any scheduling status by Associate, Manager, or
  Founder. Terminal.
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
├── auth/                  login, refresh, logout, /me, middleware, role guards
├── users/                 CRUD + team queries
├── avatars/               catalog + SVG rendering
├── platforms/
├── profiles/
├── chat/                  one-to-one chat and to-dos
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

Access token: 15 minutes. Refresh token: 30 days, rotated on every use, stored
hashed.

### 6.2 Users

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | /users | Founder, Manager | Manager sees own team + experts. Query: role, q, active |
| POST | /users | Founder, Manager | Manager may create Associates only. time_zone accepted for Experts only |
| GET | /users/:id | Founder, Manager | |
| PATCH | /users/:id | Founder, Manager | nickname, manager_id, is_active; time_zone for Experts, Founder only |
| GET | /users/me/team | Manager | Associates under this Manager |

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
| POST | /profiles | Founder, Associate. { name, linkedinUrl?, briefExperience?, avatarId, dateOfBirth?, gender?, nationality?, location?, education?, careerHistory?, currentAddress? (Founder only) }. A Founder's profile is approved at once; an Associate's is pending and every active Founder gets `profile.submitted` |
| PATCH | /profiles/:id | Founder (no re-approval), or the author of a pending or rejected submission (sends it back to pending and notifies the Founders). Approved profiles: Founder only |
| POST | /profiles/:id/approve | Founder. Pending only; author is notified |
| POST | /profiles/:id/reject | Founder. { reason } required; author is notified |
| PATCH | /profiles/:id/active | Founder. { isActive }. A deactivated Profile disappears for everyone else and cannot be booked |
| PUT | /profiles/:id/platforms/:platformId | Founder. { status?: not_registered \| registered \| banned, rate?: USD per hour, 0–1,000,000, two decimals, or null to clear }. At least one of the two. `registered` needs a rate (still editable afterwards), and a registered row cannot have its rate cleared |

Profile responses include the personal details and `platformStatuses`: one
entry per platform ({ platform: { id, name, priority }, status, rate }) in priority
order, `not_registered` when never set. Experts get `platformStatuses: null`.
`currentAddress`, `bankCount` and `needsBank` are null for everyone except the
Founder.

A call can only be created with an approved profile (409
`profile_not_approved`).

### 6.5 Calls

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | /calls | all | Scoped per role (§2.3). Query: status (repeatable), associate_id, expert_id, platform_id, from, to, q, sort, page, pageSize |
| POST | /calls | Founder, Manager, Associate | { platform_id, profile_id, associate_id?, expert_id?, scheduled_at, duration_minutes, project_details, platform_associate_name, notes? }. The profile must be approved. Founder and Manager must pass associate_id |
| GET | /calls/:id | participants | Includes platform, profile, associate, manager, expert and the history (`messages` is always empty while messaging is off) |
| PATCH | /calls/:id | per §2.3 | associate_id, expert_id, platform_id, scheduled_at, duration_minutes, project_details, platform_associate_name, notes, invoice_*, gpt_link (Founder only), rate_override. scheduled_at and duration_minutes can change but not be cleared. 409 `expert_busy` if a booked call would overlap another |
| POST | /calls/:id/transition | per §4 | { to, comment?, ninjaLink?, actualDurationMinutes?, rating?, feedback? } → 200 with updated Call; 400 when a required field for the step is missing (§4.2); 409 (invalid edge, or `expert_busy` when moving to a blocking status would double-book the Expert) |
| GET | /calls/:id/history | participants | Status history (Experts: without invoicing steps) |
| GET | /calls/:id/messages | participants | **Switched off** (404). Cursor paginated when on |
| POST | /calls/:id/messages | participants | **Switched off** (404). { body } when on |

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
  "invoiceAmount": null,
  "invoiceCurrency": null,
  "ninjaLink": null,
  "actualDurationMinutes": null,
  "rating": null,
  "feedback": null,
  "allowedTransitions": ["on_rescheduling"],
  "permissions": { "edit": true, "reassignAssociate": false, "reassignExpert": false, "editInvoice": false },
  "createdBy": { "id": "…", "nickname": "…", "role": "associate", "avatarId": "…" },
  "createdAt": "…",
  "updatedAt": "…"
}
```

`allowedTransitions` and `permissions` are computed server-side for the
requesting user so clients never guess. For Experts, `status` never shows an
invoicing status and the invoice fields are null (§2.3).

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
  { startsAt, endsAt }, with no profile, platform or associate. An Associate
  therefore never sees another Associate's call.
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
| POST | /profiles/:id/banks | Founder | { bankName, accountHolder, accountNumber, swiftBic?, routingNumber?, country?, currency?, notes?, isPrimary? }. The first bank becomes primary |
| PATCH | /banks/:id | Founder | Any field; `isPrimary: true` moves the primary flag here |
| DELETE | /banks/:id | Founder | If it was primary, the oldest remaining bank becomes primary |
| PUT | /me/photo | any user | { dataUrl } — a `data:image/(jpeg\|png\|webp);base64,…` URL, ≤ 400 KB; bytes must match the declared type |
| DELETE | /me/photo | any user | |
| PUT / DELETE | /profiles/:id/photo | Founder | Same body |
| GET | /photos/:id | public | Cacheable, like avatar images |

Profile responses carry `photoId`, and for the Founder `bankCount` and
`needsBank` (null for everyone else).

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
- `tasks.profilesNeedingBank`: Profiles with a booked call and no bank, with
  the number of booked calls and the next upcoming one.
- `database`: current database size and per-table sizes.

### 6.11 Chat and tasks **[Implementation]**

One-to-one chats. Who may chat with whom (`canChat` in
`packages/shared/src/chat.ts`, enforced by the API):

- a Founder with anyone;
- Managers with Managers;
- Associates with Managers (any Manager, not only their own).

Associates don't chat with other Associates, and Experts chat only with
Founders. A chat that the rules no longer allow (for example one between two
Associates from before this rule) stays readable, with `canSend: false`.

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | /chat/contacts | all | Active users the caller may chat with |
| GET | /chat/conversations | all | The caller's chats with at least one message, newest first: { id, other (+ isActive), lastMessage, unreadCount, openTodoCount, otherLastReadAt, canSend } |
| POST | /chat/conversations | all | { userId }. Opens or creates the chat (201). 403 when the rules don't allow it |
| GET | /chat/conversations/:id | the two people | 404 for anyone else |
| GET | /chat/conversations/:id/messages | the two people | Pages of `limit` (≤ 100) messages, oldest → newest: the latest without cursors, older ones with `cursor` (a page's `nextCursor`), newer ones with `after` (a page's `newerCursor`, while `hasNewer`). Each message: { id, sender, body, kind, replyTo, todo, createdAt } |
| POST | /chat/conversations/:id/messages | the two people | { body }. 403 when the other person is inactive or no longer allowed (`canSend: false`) |
| POST | /chat/conversations/:id/read | the two people | Marks the chat read (204) |
| POST | /chat/conversations/:id/messages (pictures) | the two people | **[Implementation]** { body, image?: { dataUrl, width, height } }. The browser shrinks a picture to at most 1600 px and 1 MB (JPEG, PNG or WebP; the bytes are checked); the body is then an optional caption. Pictures live in `chat_images` |
| GET | /chat/images/:id | the two people | The picture bytes (`Cache-Control: private`) |
| DELETE | /chat/messages/:id | the sender | Deletes for both: body erased, picture row deleted at once, reactions removed; a "deleted" placeholder stays. 409 for a message that is a task or a task's done reply. Emits `chat:message-updated` |
| POST | /chat/messages/:id/reactions | the two people | { emoji }. Toggles the caller's reaction (up to 10 per person per message); not on deleted messages or closed chats. Emits `chat:message-updated` |
| POST | /chat/messages/:id/todo | a participant who may give the other person tasks | Turns a regular message into a task for the other person (`todo.assigned`). Founder → anyone, Manager → own-team Associates; 403 otherwise, 409 if already a task. Conversations carry `canGiveTask` |
| DELETE | /chat/messages/:id/todo | the giver | Removes an open task. 409 once done |
| GET | /todos/assignees | Founder, Manager | People the caller may give a task to |
| POST | /todos | Founder, Manager | { assigneeId, title, details? }: a task without a chat message |
| DELETE | /todos/:id | the giver | Removes an open task |
| GET | /todos | giver or taker | Query: scope = assigned (default) \| created (Founders and Managers), status = active (default: open + done) \| open \| done \| completed \| all. Open first |
| POST | /todos/:id/done | the taker | { note? }. open → done; for a chat task posts a `todo_done` reply (body = note or "Done"). The giver gets `todo.done` |
| POST | /todos/:id/confirm | the giver | done → completed (`confirmed_at`); the taker gets `todo.completed`. Completed tasks leave the default list |
| POST | /todos/:id/reopen | the giver | { note? }. done or completed → open, clearing the done state; the taker gets `todo.reopened` |

Sending a message counts as reading the chat. A chat message is pushed to the
other person's browsers (§7.5); it does not create a bell notification.

### 6.12 Presence **[Implementation]**

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | /presence | all | `[{ userId, status, lastSeenAt }]` for everyone the caller may chat with (§6.11 rules); `lastSeenAt` is filled in only when offline |

Live changes arrive over the socket as `presence:update` (§7.6).

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
| GET | /stats/associates | Founder (all Associates), Manager (own team), Associate (self) | Per Associate and period: calls, finished calls, potential money and unpriced calls, plus totals. Potential money = rate × duration, the real duration once the Expert finished the call and the booked duration before; the rate is the call's special rate or the Profile's platform rate. Calls without a rate count as unpriced. Deactivated Associates appear only with calls in the range. Experts: 403 |
| GET | /stats/profiles | Founder | Every Profile including pending, rejected and deactivated: status, active, onboard date, email, primary bank (name, country, currency, count), calls, paid calls, expected income (finished calls), total income (sum of real income), last call already started. Audited as a sensitive read |
| GET | /stats/finance | Founder | Per period, and over the range per platform and per Profile: calls, finished calls, paid calls, expected (expected price of finished calls), paidExpected and real (calls with real income), gap = paidExpected − real, unpriced |

Web: **Statistics** (Founder, Manager, Associate) with Weekly / Bi-weekly / Monthly. Founders also get the *By profile* table (filters All / Active / Deactivated / Pending / Rejected, sort, search) and *Finance* (Expected, Real income, Gap on paid calls, Not paid yet; tables by period, platform and Profile with expected-vs-real bars).

### 6.15 Health

`GET /healthz` (outside `/api/v1`) returns `{ status, db, uptime }`; 503 when
the database is unreachable.

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
| call:message | call:{id} | Message with sender nickname + role |
| notification:new | user:{id} | Notification |
| user:typing | call:{id} | { callId, userId, nickname } |
| presence:update | user:{id} | `PresenceDTO[]`: who came online, went away or left (§7.6) |
| session:revoked | user:{id} | Sent before a deactivated user's sockets are dropped |
| chat:message | both people's user rooms | ChatMessage |
| chat:todo | giver's and taker's user rooms | Todo, or { id, conversationId, messageId, removed: true } (ids null for standalone tasks) |
| chat:read | both people's user rooms | { conversationId, userId, readAt } |

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
- The web app asks once (a prompt on Chat and To-dos; Settings → Browser
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
- A sweeper flips idle connections to `away` once a minute.

---

## 8. Security

- Passwords hashed with argon2id. Unknown emails still cost a hash comparison, so response timing doesn't reveal which emails exist.
- JWT signed with HS256, secret from environment, 15-minute expiry.
- Refresh tokens random 256-bit, stored hashed, rotated, family revoked on
  reuse detection.
- Rate limit `/auth/login` (5 per minute per IP). **[Implementation]** Only
  failed attempts count, so an office behind one IP is not locked out.
- All access decisions made on the server using the shared rule table plus
  relationship checks. Clients never send their role. The user is reloaded
  from the database on every request, so deactivation and role changes take
  effect immediately.
- Helmet headers, strict CORS allowlist, request body limit 1 MB.
- Audit: every status change recorded with actor and override flag.
- Deactivated users: refresh rejected, refresh tokens revoked, sockets disconnected.
- Logs redact authorization headers, cookies, passwords, refresh tokens and emails.
- **[Implementation]** `TRUST_PROXY` sets how many proxy hops' `X-Forwarded-For`
  to trust (2 behind Vercel → Render), so the login limit counts real client IPs.

---

## 9. Web application (Phase 1)

### 9.1 Screens

| Screen | Roles | Content |
|---|---|---|
| Login | all | Email + password |
| Dashboard | all | **Today**: Ongoing, Coming up and Finished calls, one line each (time, profile, platform, Expert). Founder: **Pending tasks** (finished calls to invoice, Profiles that need a bank, with an Add bank shortcut), the **database size**, and **Backups** (the last nightly dump with its size and row count, Run now, and Download per kept dump). Manager: team counts per stage |
| Call list | all | Table with filters (status, associate, expert, date range, search), live updates; filters live in the URL |
| Call detail | participants | Header with "View profile details", status timeline (Experts: without Invoicing), transition buttons from `allowedTransitions`, assignment controls, status history, a Call card (Ninja link with "Join call", actual duration, and the rating and note of older calls), a **GPT link** card (the Founder edits it, the Expert reads it) and a **Rate** card (the platform rate plus a special rate for this call, hidden from Experts). Confirming shows the time in the Expert's zone; starting asks for the Ninja link; finishing asks only for the real duration; an Expert requesting rescheduling is reminded to update their calendar and must give a reason. The message thread is hidden while messaging is off |
| New Call | Founder, Manager, Associate | Required fields are marked with *. In this order: Profile (approved and active only, no inline create); Project (platform, platform associate, project details, notes; Associate for Founder and Manager); When (date, time, duration); Expert last, with the Expert's local time and whether they're free. Saving asks for confirmation when the time is today, in the past, clashes with another call, or falls in time off. Accepts `?expertId=&start=&duration=` from the calendar |
| Calendar | all | Day, week and month views of an Expert's time off and calls (§6.9). Experts drag to add time off; others drag to start a call. Extra clocks for team time, the Expert's zone and a client zone. Availability (working hours) is hidden in the web app for now; the API still supports it. An "All experts" view (not for Experts) splits each day into one column per Expert, each in a fixed color: an empty column is a free Expert, and dragging across a time lists who is free, with a Schedule button for each |
| Profiles | all | Cards with a details window (personal details, history; platform statuses for everyone but Experts; for the Founder a private section with the current address and banks). Founders add profiles (approved at once), review Associate submissions, upload photos, manage banks, deactivate a Profile ("Needs bank" and "Deactivated" filters) and by default see a table of every Profile against every platform, editable in place. Associates submit profiles for review. Experts see the Profiles of their calls |
| Chat | all | Chat list (search, unread counts, open task marker) beside the conversation; the thread loads 40 messages at a time as you scroll up or down and keeps at most 5 pages (200 messages) in memory, with "Jump to latest" while an older window is shown; New chat lists only people the rules allow. Live messages, "Seen", read-only when the other person is inactive. Founders and Managers open a message's menu to give it as a task (when `canGiveTask`); the taker gets "Mark done" on it and the giver "Confirm" once done |
| Tasks | all | Assigned to me / Given by me (Founders, Managers) with filters Active / Open / Waiting for confirmation / Completed / All. "Mark done" (optional note), "Confirm", "Reopen" (optional note), "Remove" while open, "New task" |
| Platforms | Founder, Manager | List + create/edit, sorted by priority |
| Team | Manager | Own Associates, create, deactivate |
| Users | Founder | All users, create any role |
| Invoicing | Founder | Calls in `finished` and invoice stages, amount entry, batch transitions |
| Notifications | all | List, mark read |
| Settings | all | Nickname (Founder-approved change **[Assumption]**, read-only for now), password, photo upload or avatar, appearance, browser notifications (on/off, send a test); Experts also set their time zone |

### 9.2 Role landing pages

Every role lands on **Today** (their visible calls for the day). The Manager
also sees per-Associate counts by stage; the Founder also sees pending tasks and
the database size.

### 9.3 Behaviour

- Every list subscribes to `call:updated` and patches the TanStack Query cache;
  chat and to-do screens follow `chat:message`, `chat:todo` and `chat:read`.
- The sidebar shows unread chat messages on Chat, and on Tasks the open tasks given to me plus done tasks I gave that wait for my confirmation.
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
| REFRESH_TOKEN_TTL | 30d |
| CORS_ORIGINS | http://localhost:5173,http://192.168.0.10:5173 |
| PORT | 4000 |
| HOST | 0.0.0.0 |
| PUBLIC_API_URL | http://localhost:4000 |
| LOGIN_RATE_LIMIT | 5 |
| COOKIE_SECURE | true in production |
| LOG_LEVEL | info |
| TRUST_PROXY | 1 (2 behind Vercel → Render) |
| VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY | Browser push keys (`npx web-push generate-vapid-keys`); empty = push off |
| VAPID_SUBJECT | mailto:admin@god-system.app |
| DB_DUMPS_ENABLED | true (false turns the nightly dump off) |
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

### 12.4 Testing

- Unit (`packages/shared`, 1078 tests): `canTransition` against every (role,
  from, to) combination with and without the relationship; who may chat with
  whom; what Experts see of invoicing; repeat expansion
  for each repeat form, checked against a day-by-day reference, including
  daylight saving changes; block validation; edit scopes.
- API (`apps/api`, 284 tests): transition endpoint returns 403 for wrong role,
  409 for wrong edge, 200 and a history row for valid moves; confirmation,
  rescheduling requests, Ninja link and duration rules; Experts never seeing
  invoicing, rates, bank data or invoice figures; platform rates (Founder-only,
  required once registered); Profile deactivation; the GPT link reaching only
  the Founder and the Expert; per-call rates; presence per role; database dumps
  (contents, retention, Founder-only access); Profile submissions, personal details, founder-only address
  and platform statuses; chat rules, unread counts, to-dos and their done
  replies; browser push subscriptions and delivery (push service mocked);
  per-Call messages switched off; anonymity check
  that no response contains an email; time zone permissions; schedule block
  edit scopes; calendar privacy (Associates see other Associates' calls only
  as busy time); double booking rejected with 409; auth rotation and reuse
  detection; rate limiting; database constraints.
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
  Vercel URL with `https://`), `COOKIE_SECURE=true`, `TRUST_PROXY=2`, and the
  VAPID keys. Auto-deploy needs Render's GitHub app to have access to the
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
- Analytics dashboard for Founder: calls per stage, cycle time, per-Platform
  and per-Associate throughput.
- Group chats; typing indicators and attachments in chat.
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
4. Is `invoice_amount` entered per Call or imported from an external system?
   (Currently: per Call, on the Invoicing screen and Call detail.)
5. Does one Call ever involve more than one Expert?
6. Should Managers also be able to add Profiles, and to change platform
   statuses? (Currently: Associates submit, Founders approve and set statuses.)
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
| Participant | The Associate, Expert, Associate's Manager, and Founder for a given Call |
| Confirmed | The Expert has confirmed they are available for the scheduled time |
| Ninja link | The VDO.Ninja meeting link the Expert adds when a call starts |
| Platform status | A Profile's standing on an expert network platform: not registered, registered or banned |
| Conversation | A one-to-one chat between two users |
| Task (to-do) | Work given by someone above you (Founder → anyone, Manager → own-team Associates), from a chat message or New task. The taker marks it done, the giver confirms it: completed |

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
| 2026-09-16 | Tasks: Founders give tasks to anyone, Managers to Associates on their own team, from a chat message or with New task. The taker marks a task done, the giver confirms it (completed, hidden from the default list) or reopens it |
| 2026-09-16 | Statistics: by Associate (weekly, bi-weekly, monthly calls and potential money; Founders see all, Managers their team, Associates themselves), by Profile for the Founder (onboard date, status incl. deactivated, email, bank, total income) and Finance for the Founder (expected vs real income per period, platform and Profile, and the gap) |
| 2026-09-16 | Chat threads load older and newer messages automatically while scrolling and keep only a 200-message window in memory (`after` cursor on chat messages) |
| 2026-09-17 | Sign in with Google: Google accounts link to existing users by their sign-in email the first time and by Google's account id afterwards; the Founder sees and edits a user's sign-in email and can unlink Google |
| 2026-09-17 | Managers have every Associate function: they run calls themselves (as the call's Associate), add profiles for review, and see their own row in Statistics |
| 2026-09-17 | Chat: delete your own messages for both people (a placeholder stays), paste, drop or attach pictures (shrunk in the browser, stored in the database), an emoji picker, and emoji reactions |
| 2026-09-17 | Founders can delete a user account: everything personal is erased and the nickname freed, while the person's calls, messages and history stay as a removed user |
