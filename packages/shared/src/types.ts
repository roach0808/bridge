import type { AvatarAudience, AvatarStyle } from './avatars';
import type { CallStatus } from './callStatus';
import type { Role } from './roles';
import type { BlockRule, Occurrence } from './scheduleBlocks';
import type { ChatMessageKind, TodoImportance, TodoStatus, TodoUrgency } from './chat';
import type { Payee } from './payouts';
import type { PresenceStatus } from './presence';
import type { PlatformRegistration } from './schemas';

/** The only identity ever exposed about another user (§2.2). */
export interface UserRef {
  id: string;
  nickname: string;
  role: Role;
  avatarId: string;
  /** Uploaded picture, shown instead of the catalog avatar when set. */
  photoId: string | null;
}

export interface UserDTO extends UserRef {
  managerId: string | null;
  manager: UserRef | null;
  isActive: boolean;
  timeZone: string;
  /** Experts: USD per hour of call. Only the Founder and the Expert themselves receive it. */
  hourlyRate: number | null;
  /** Associates: their percent of a call's real income. Only the Founder and the Associate themselves receive it. */
  sharePercent: number | null;
  createdAt: string;
  updatedAt: string;
}

/** Only `/me` returns the email. */
export interface MeDTO extends UserDTO {
  email: string;
  /**
   * The one Founder who owns the system (`OWNER_EMAIL`). A few things are
   * theirs alone: the device an audit entry came from, and reading the chats
   * of everyone else.
   */
  isOwner: boolean;
}

/**
 * A chat between two other people, as the owner reads it (§6.11a). There is no
 * "other" person here and nothing to send: the owner is looking on, not talking.
 */
export interface ObservedChatDTO {
  id: string;
  people: [UserRef, UserRef];
  lastMessage: ConversationDTO['lastMessage'];
  messageCount: number;
  createdAt: string;
}

/** What the login page needs before anyone signs in. */
export interface AuthConfigDTO {
  /** Null when Google sign-in is not set up. */
  googleClientId: string | null;
}

/** A Google account linked to a user. */
export interface GoogleLinkDTO {
  email: string | null;
  linkedAt: string;
  lastUsedAt: string | null;
}

/** Founder only: how someone signs in. */
export interface SignInDetailsDTO {
  email: string;
  google: GoogleLinkDTO | null;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: MeDTO;
}

export interface AvatarDTO {
  id: string;
  audience: AvatarAudience;
  style: AvatarStyle;
  seed: string;
  background: string;
  label: string;
  sortOrder: number;
  url: string;
}

export interface PlatformDTO {
  id: string;
  name: string;
  url: string;
  priority: number;
  country: string;
  createdAt: string;
  updatedAt: string;
}

export type ProfileStatus = 'pending' | 'approved' | 'rejected';

export interface ProfilePlatformStatusDTO {
  platform: Pick<PlatformDTO, 'id' | 'name' | 'priority'>;
  status: PlatformRegistration;
  /** USD per hour. Null until the Founder sets it; required while registered. */
  rate: number | null;
}

export interface ProfileAddressDTO {
  id: string;
  label: string;
  address: string;
}

export interface ProfileDTO {
  id: string;
  name: string;
  linkedinUrl: string | null;
  briefExperience: string;
  /** yyyy-mm-dd */
  dateOfBirth: string | null;
  gender: string | null;
  nationality: string | null;
  location: string | null;
  education: string | null;
  careerHistory: string | null;
  /** The Profile's own email and phone. Null for Experts. */
  email: string | null;
  phone: string | null;
  /** yyyy-mm-dd: when the Profile was onboarded. Null for Experts. */
  onboardedAt: string | null;
  /** Founder only (null for everyone else). */
  addresses: ProfileAddressDTO[] | null;
  avatarId: string;
  photoId: string | null;
  status: ProfileStatus;
  /** Deactivated Profiles are listed for Founders only and cannot be booked. */
  isActive: boolean;
  /**
   * One entry per platform (by priority), `not_registered` when never set.
   * Null for Experts, who only see the personal details.
   */
  platformStatuses: ProfilePlatformStatusDTO[] | null;
  /** Founder only (null for others): how many banks the Profile has. */
  /** Accounts that can still be paid into. */
  bankCount: number | null;
  /** Founder only: the Profile has a booked call but no bank. */
  needsBank: boolean | null;
  /** The Associate (or Manager) who looks after this Profile. Null for Experts. */
  associate: UserRef | null;
  /**
   * The Manager the Profile sits under: the Associate's Manager, or the Manager
   * themselves when one looks after it. Null for Experts, and while nobody does.
   */
  manager: UserRef | null;
  /** The viewer may hand the Profile to another Associate (the Founder; a Manager within their team). */
  canAssign: boolean;
  /** The viewer may change the Profile's status on the platforms (the Founder; its Associate; their Manager). */
  canEditPlatforms: boolean;
  /** The Manager's percent of this Profile's real income. Founder and Managers only. */
  managerSharePercent: number | null;
  createdBy: UserRef;
  reviewedBy: UserRef | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CallDTO {
  id: string;
  status: CallStatus;
  /** Platform links are not shown in calls. */
  platform: Pick<PlatformDTO, 'id' | 'name' | 'country' | 'priority'>;
  profile: Pick<ProfileDTO, 'id' | 'name' | 'linkedinUrl' | 'briefExperience' | 'avatarId' | 'photoId'>;
  associate: UserRef;
  manager: UserRef | null;
  /** Includes the Expert's IANA zone so clients can show their local time. */
  expert: ExpertRef | null;
  scheduledAt: string;
  durationMinutes: number;
  endsAt: string;
  notes: string | null;
  projectDetails: string;
  platformAssociateName: string;
  /** How to join the platform's meeting (link, passcode…), added by whoever runs the call. Everyone on the call reads it. */
  meetingDetails: string | null;
  /** Rate x actual duration (USD). Null until both are known, and always null for Experts and Associates. */
  expectedPrice: number | null;
  /** What reached the bank (USD), entered when processed to bank. Null for Experts and Associates. */
  realIncome: number | null;
  /** Added by the Expert when the call starts. Only the Founder and the Expert receive it. */
  ninjaLink: string | null;
  /** The research data for preparing the call. Only the Founder (who sets it) and the Expert receive it. */
  researchLink: string | null;
  /** The Profile's rate on the call's platform, and this call's override. Null for Experts and Associates. */
  platformRate: number | null;
  rateOverride: number | null;
  /** Entered by the Expert when finishing. */
  actualDurationMinutes: number | null;
  /** 1–5, entered by the Expert when finishing. */
  rating: number | null;
  feedback: string | null;
  allowedTransitions: CallStatus[];
  permissions: CallPermissions;
  /** What the call pays, showing only the lines the viewer may see. */
  payouts: CallPayouts;
  /** Founder only: the Profile has an open bank account to be paid into. Null for everyone else. */
  bankReady: boolean | null;
  createdBy: UserRef;
  createdAt: string;
  updatedAt: string;
}

/** One person's pay for a call, and whether it was paid. */
export interface PayoutLine {
  /** What they are paid (USD): for a share, from the real income once the bank has paid. Null until known. */
  amount: number | null;
  /** What it should come to (USD): for a share, from the expected price. Null without a rate. */
  expected: number | null;
  paidAt: string | null;
}

/**
 * Who is paid what for a call (§3.1), once it took place. Each line is null for
 * viewers who may not see it:
 * - `expert`: the Founder and the Expert;
 * - `manager`: the Founder, the Manager paid for it and the call's Associate
 *   (who sees the amounts, not the percent);
 * - `associate`, when an Associate ran the call: the Founder, their Manager and
 *   the Associate.
 * The shares show what they should come to (`expected`) from the call on, and
 * what they are (`amount`) once the bank has paid.
 */
export interface CallPayouts {
  /** The Expert's rate when the call finished × the real duration. */
  expert: (PayoutLine & { user: UserRef; rate: number | null; minutes: number | null }) | null;
  /**
   * The Manager's share of the income, including the Associate's part; `keeps` is what stays with the Manager.
   * `settled` once paid to bank: the percent and the Manager are then fixed. `percent` is null for the Associate.
   */
  manager: (PayoutLine & { user: UserRef | null; percent: number | null; keeps: number | null; settled: boolean }) | null;
  /** The Associate's part: `percent` of the Manager's share, paid by the Manager. */
  associate: (PayoutLine & { user: UserRef; percent: number }) | null;
  /** The lines the viewer may mark paid or unpaid. */
  canMark: Payee[];
}

/** Server-computed, so clients never guess which controls to render. */
export interface CallPermissions {
  edit: boolean;
  reassignAssociate: boolean;
  reassignExpert: boolean;
  /** Founder only: correct the real income of a paid call. */
  editIncome: boolean;
  /** Founder only. */
  editResearchLink: boolean;
  /** The call's Manager or the Founder (Associates never see rates). */
  editRate: boolean;
  /** Whoever runs the call, their Manager, or the Founder, until it took place (the Founder always). */
  editMeeting: boolean;
  /** Founder only: the Expert's rate for this call, until the Expert is paid. */
  editExpertRate: boolean;
}

export interface StatusHistoryDTO {
  id: string;
  callId: string;
  fromStatus: CallStatus | null;
  toStatus: CallStatus;
  actor: UserRef;
  isOverride: boolean;
  comment: string | null;
  createdAt: string;
}

export interface MessageDTO {
  id: string;
  callId: string;
  sender: UserRef;
  body: string;
  createdAt: string;
}

export interface CallDetailDTO extends CallDTO {
  messages: MessageDTO[];
  history: StatusHistoryDTO[];
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * A window of chat messages, oldest → newest. `nextCursor` loads older ones;
 * `newerCursor` (with `after`) loads newer ones while `hasNewer` is true.
 */
export interface ChatMessagePage extends CursorPage<ChatMessageDTO> {
  newerCursor: string | null;
  hasNewer: boolean;
}

export type NotificationType =
  | 'call.status_changed'
  | 'call.assigned'
  | 'call.message'
  | 'call.updated'
  | 'call.created'
  /** The Founder (or the Manager) marked someone's pay for one or more calls as paid. */
  | 'call.paid'
  | 'todo.assigned'
  /** The owner cannot get on with a task and has said why. */
  | 'todo.blocked'
  | 'todo.done'
  | 'todo.completed'
  | 'todo.reopened'
  | 'profile.submitted'
  | 'profile.approved'
  | 'profile.rejected';

export interface NotificationPayload {
  callId?: string;
  conversationId?: string;
  todoId?: string;
  profileId?: string;
  from?: CallStatus | null;
  to?: CallStatus;
  actor?: { nickname: string; role: Role };
  summary?: string;
  [key: string]: unknown;
}

export interface NotificationDTO {
  id: string;
  type: NotificationType;
  payload: NotificationPayload;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationList {
  items: NotificationDTO[];
  unreadCount: number;
}

export interface ScheduleBlockDTO extends BlockRule {
  id: string;
  expertId: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExpertRef extends UserRef {
  timeZone: string;
}

export interface BusyInterval {
  startsAt: string;
  endsAt: string;
  /** A call that is still being scheduled: it may yet move. */
  tentative?: boolean;
}

export interface CalendarCall {
  id: string;
  status: CallStatus;
  scheduledAt: string;
  endsAt: string;
  durationMinutes: number;
  platform: { id: string; name: string };
  profile: { id: string; name: string; avatarId: string; photoId: string | null };
  associate: UserRef;
  expert: UserRef | null;
}

export interface CalendarResponse {
  from: string;
  to: string;
  expert: ExpertRef | null;
  canEditBlocks: boolean;
  calls: CalendarCall[];
  busy: BusyInterval[];
  occurrences: Occurrence[];
  /** Only for the Expert and the Founder. */
  rules: ScheduleBlockDTO[];
}

export interface ExpertColumn {
  expert: ExpertRef;
  slot: number;
  calls: CalendarCall[];
  busy: BusyInterval[];
  occurrences: Occurrence[];
}

export interface ExpertsCalendarResponse {
  from: string;
  to: string;
  experts: ExpertColumn[];
}

/** A signed-in session: one browser or app, until the user signs out. */
export interface SessionDTO {
  id: string;
  /** desktop, mobile, tablet or unknown. */
  deviceType: string;
  browser: string | null;
  os: string | null;
  /** Two-letter country, when the proxy reports it. */
  country: string | null;
  ip: string | null;
  /** True for the session making the request. */
  current: boolean;
  signedInAt: string;
  lastUsedAt: string;
}

/** One line of the audit trail. Founders only. */
export interface AuditEntryDTO {
  id: string;
  userId: string | null;
  actorName: string | null;
  actorRole: Role | null;
  /** Dotted family and verb, e.g. `call.transition` or `bank.read`. */
  action: string;
  summary: string;
  entityType: string | null;
  entityId: string | null;
  method: string;
  path: string;
  statusCode: number;
  ip: string | null;
  country: string | null;
  deviceType: string | null;
  /** The browser it came from, e.g. "US-desktop-01". Only the owner is shown it; null for anyone else. */
  device: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export interface BankDTO {
  id: string;
  profileId: string;
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  swiftBic: string | null;
  routingNumber: string | null;
  country: string | null;
  currency: string | null;
  notes: string | null;
  /** False once the account is closed: kept on file, but the Profile needs another one. */
  isActive: boolean;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A finished call whose Profile has no rate on the platform it was booked through. */
export interface ProfileNeedingRate {
  profile: Pick<ProfileDTO, 'id' | 'name' | 'avatarId' | 'photoId'>;
  platform: Pick<PlatformDTO, 'id' | 'name'>;
  /** Finished (or later) calls waiting on this rate. */
  finishedCalls: number;
}

export interface ProfileNeedingBank {
  profile: Pick<ProfileDTO, 'id' | 'name' | 'avatarId' | 'photoId'>;
  /** Booked calls (scheduled or later). */
  bookedCalls: number;
  nextCallAt: string | null;
}

export interface DashboardSummary {
  /** Calls of the viewer's local day (§9.3 zone), visible to the viewer. */
  today: {
    date: string;
    zone: string;
    ongoing: CallDTO[];
    upcoming: CallDTO[];
    finished: CallDTO[];
  };
  byStatus: Record<CallStatus, number>;
  team?: Array<{ associate: UserRef; byStatus: Record<CallStatus, number> }>;
  /** Founder only. */
  tasks?: {
    invoicesToSubmit: CallDTO[];
    /** Booked calls coming up that still need their research data (confirmed ones wait for "Research data ready"). */
    callsNeedingResearch: CallDTO[];
    profilesNeedingBank: ProfileNeedingBank[];
    profilesNeedingRate: ProfileNeedingRate[];
  };
  /** Founder only. */
  database?: {
    sizeBytes: number;
    tables: Array<{ name: string; bytes: number; rows: number }>;
  };
}

// --- Chat & to-dos ------------------------------------------------------------

/** The task attached to a chat message, if someone above the other person marked it. */
export interface TodoSummary {
  id: string;
  status: TodoStatus;
  /** Which quadrant of the board it sits in. */
  urgency: TodoUrgency;
  importance: TodoImportance;
  assignee: UserRef;
  createdBy: UserRef;
  doneAt: string | null;
  /** When the giver confirmed it; the task is then completed. */
  confirmedAt: string | null;
}

export interface ChatMessageDTO {
  id: string;
  conversationId: string;
  sender: UserRef;
  body: string;
  /** `todo_done` is the reply posted when the assignee marks a to-do done. */
  kind: ChatMessageKind;
  replyTo: { id: string; body: string; sender: UserRef; deleted: boolean; hasImage: boolean } | null;
  todo: TodoSummary | null;
  /** A picture; load it with its id (the two people in the chat only). Its size avoids layout jumps. */
  image: { id: string; width: number; height: number } | null;
  /** Deleted by the sender: the body is empty and there is no picture. */
  deleted: boolean;
  /** Grouped by emoji, in the order they were first used. */
  reactions: Array<{ emoji: string; userIds: string[] }>;
  createdAt: string;
}

export interface ConversationDTO {
  id: string;
  other: UserRef & { isActive: boolean };
  lastMessage: (Pick<ChatMessageDTO, 'id' | 'body' | 'kind' | 'deleted' | 'createdAt'> & { senderId: string; hasImage: boolean }) | null;
  unreadCount: number;
  /** Open to-dos in this chat (assigned to either person). */
  openTodoCount: number;
  /** When the other person last read the chat (for "Seen"). */
  otherLastReadAt: string | null;
  /** Both people are active and still allowed to chat. */
  canSend: boolean;
  /** The caller may turn messages in this chat into tasks for the other person. */
  canGiveTask: boolean;
  createdAt: string;
}

export interface TodoDTO extends TodoSummary {
  /** Set for tasks made from a chat message. */
  conversationId: string | null;
  message: { id: string; body: string; sender: UserRef; createdAt: string } | null;
  /** Set for tasks made with "New task". */
  title: string | null;
  details: string | null;
  /** The note the assignee added when marking it done. */
  doneNote: string | null;
  /** Why the task is blocked; set exactly while its status is `blocked`. */
  blockedReason: string | null;
  /**
   * When work should begin, and when it must already be finished. Two separate
   * things: a deadline is not a start date (§ tasks). `…HasTime` is false when
   * only a day was given, and the time of day means nothing.
   */
  startByAt: string | null;
  startByHasTime: boolean;
  completeByAt: string | null;
  completeByHasTime: boolean;
  /** The zone those times were written in; the owner's when nobody said otherwise. */
  timeZone: string;
  /** What must be produced, and how completion is judged. */
  expectedDeliverable: string | null;
  definitionOfDone: string | null;
  /** Tasks that must happen first; this one is waiting while any is unfinished. */
  dependsOn: TodoDependency[];
  createdAt: string;
  updatedAt: string;
}

/** A task this one waits for, as much of it as the waiting task needs to show. */
export interface TodoDependency {
  id: string;
  title: string;
  status: TodoStatus;
  assignee: UserRef;
}

// --- Statistics ------------------------------------------------------------------

export type StatsPeriodKind = 'week' | 'biweek' | 'month';

/** One reporting period in the team time zone: [start, end) as dates. */
export interface StatsPeriod {
  start: string;
  end: string;
  label: string;
}

/**
 * Calls counted by their scheduled time. `potential` is rate × duration: the
 * real duration once the Expert finished the call, the booked one before.
 * Calls whose Profile has no rate on the platform are in `unpriced`.
 */
export interface AssociateStatsCell {
  calls: number;
  finishedCalls: number;
  potential: number;
  unpriced: number;
}

export interface AssociateStatsRow {
  associate: UserRef & { isActive: boolean };
  manager: UserRef | null;
  periods: AssociateStatsCell[];
  total: AssociateStatsCell;
}

/** Founders see every Associate, Managers their team, Associates themselves. */
export interface AssociateStats {
  zone: string;
  /** False for Associates, who do not see what calls bring in: `potential` is then 0. */
  showsMoney: boolean;
  periods: StatsPeriod[];
  rows: AssociateStatsRow[];
  totals: AssociateStatsCell[];
  total: AssociateStatsCell;
}

/** Founder only: every Profile, including pending, rejected and deactivated ones. */
export interface ProfileStatsRow {
  profile: { id: string; name: string; avatarId: string; photoId: string | null };
  status: ProfileStatus;
  isActive: boolean;
  onboardedAt: string | null;
  email: string | null;
  /** The primary (or first) bank account, and how many there are. */
  bank: { bankName: string; country: string | null; currency: string | null; count: number } | null;
  calls: number;
  paidCalls: number;
  /** Expected price of its finished calls. */
  expectedIncome: number;
  /** Real income that reached the bank. */
  totalIncome: number;
  /** The most recent call that has already started. */
  lastCallAt: string | null;
}

/**
 * Founder only. `expected` is the expected price of finished calls; `paidExpected`
 * and `real` cover only calls processed to bank, and `gap` = paidExpected − real.
 */
export interface FinanceCell {
  calls: number;
  finishedCalls: number;
  paidCalls: number;
  expected: number;
  paidExpected: number;
  real: number;
  gap: number;
  /** Finished calls without a rate, so without an expected price. */
  unpriced: number;
}

export interface FinanceStats {
  zone: string;
  periods: StatsPeriod[];
  byPeriod: FinanceCell[];
  total: FinanceCell;
  /** Over all the periods, largest real income first. */
  byPlatform: Array<{ platform: { id: string; name: string }; cell: FinanceCell }>;
  byProfile: Array<{ profile: { id: string; name: string; isActive: boolean }; cell: FinanceCell }>;
}

/**
 * Totals for the finance tab of the Calls page, over every call that matches
 * the dates and search (the paid filter aside). Each part is null for viewers
 * it does not concern. `expected` covers calls not paid to bank yet.
 */
export interface FinanceSummary {
  calls: number;
  /** Expected income of the calls not paid to bank yet, and real income of those that were. Not for Associates. */
  income: { expected: number; real: number; unpriced: number } | null;
  /** Founder: owed to Experts. Expert: their own pay (and the minutes behind it). */
  expert: { paid: number; unpaid: number; unpriced: number; minutes: number } | null;
  /** Founder: owed to Managers. Manager: their own shares. Associate: their Manager's shares on their calls. */
  manager: { paid: number; unpaid: number; expected: number } | null;
  /** Founder and Manager: owed to Associates. Associate: their own part. */
  associate: { paid: number; unpaid: number; expected: number } | null;
  /** Manager: what stays with them once the Associates have their part. */
  keeps: number | null;
}

/** What one person was paid (or is owed) in a payment cycle. */
export interface PayCycleLine {
  user: UserRef;
  /** Paid by the Founder: Experts and Managers. Associates are paid by their Manager. */
  kind: Payee;
  amount: number;
  calls: number;
}

/**
 * A monthly payment cycle the Founder closed (§6.5a): what came in and went out
 * between `startedAt` and `closedAt`, kept as it was. Non-founders get only
 * their own lines and no totals.
 */
export interface PayCycleDTO {
  id: string;
  label: string;
  startedAt: string | null;
  closedAt: string;
  closedBy: UserRef;
  totals: { income: number; paidExperts: number; paidManagers: number; paidAssociates: number; balance: number } | null;
  lines: PayCycleLine[];
}

/** Founder: the cycle still open, and what closing it now would pay. */
export interface CurrentCycleDTO {
  /** The end of the last closed cycle; null before the first one. */
  startedAt: string | null;
  /** Real income of calls paid to bank in this cycle. */
  income: number;
  /** Paid out in this cycle so far. */
  paid: { experts: number; managers: number; associates: number };
  /** Income − what the Founder paid out (Experts and Managers). */
  balance: number;
  /** Expected income of calls that took place but have not reached the bank. */
  expectedPipeline: number;
  /** Everyone the Founder still owes, as closing the cycle would pay them. */
  toPay: PayCycleLine[];
  /** Finished calls whose Expert has no rate yet: they cannot be paid until one is set. */
  unpricedExpertCalls: number;
  /** Suggested name for the cycle, e.g. "September 2026". */
  suggestedLabel: string;
}

export interface FinanceCallsPage extends Paginated<CallDTO> {
  summary: FinanceSummary;
}

/** One person's tasks on the task board. */
export interface TodoPanel {
  person: UserRef & { isActive: boolean };
  /** True for the panel of the person looking at the board. */
  isMe: boolean;
  /** The caller may give this person tasks. */
  canGive: boolean;
  tasks: TodoDTO[];
  /**
   * Counts over all of this person's tasks, whatever the filter. `open` is
   * everything still to do — not started, in progress or blocked.
   */
  counts: { open: number; inProgress: number; blocked: number; done: number; completed: number };
}

/** Someone's presence, sent to the people who may chat with them. */
export interface PresenceDTO {
  userId: string;
  status: PresenceStatus;
  /** When they were last connected; null while online. */
  lastSeenAt: string | null;
}

/** A database dump kept for the Founder (§6.13). */
export interface DbDumpDTO {
  id: string;
  trigger: 'scheduled' | 'manual';
  succeeded: boolean;
  error: string | null;
  byteSize: number;
  /** Rows per table at the time of the dump. */
  tableCounts: Record<string, number>;
  createdAt: string;
}

export interface ChatReadEvent {
  conversationId: string;
  userId: string;
  readAt: string;
}

export interface TodoRemovedEvent {
  id: string;
  conversationId: string | null;
  messageId: string | null;
  removed: true;
}

/** What the service worker receives in a push message. */
export interface WebPushPayload {
  title: string;
  body: string;
  /** App path to open when the notification is clicked. */
  url: string;
  /** Notifications with the same tag replace each other (e.g. one per chat). */
  tag: string;
  /** `test` always shows, even while the app is open and focused. */
  kind: 'chat' | 'notification' | 'test';
}

// --- Socket events (§7) -----------------------------------------------------

export interface ServerToClientEvents {
  'call:updated': (call: CallDTO) => void;
  /** The Founder deleted the call, with everything that belonged to it. */
  'call:deleted': (event: { id: string }) => void;
  'call:message': (message: MessageDTO) => void;
  'notification:new': (notification: NotificationDTO) => void;
  'chat:message': (message: ChatMessageDTO) => void;
  'chat:todo': (todo: TodoDTO | TodoRemovedEvent) => void;
  /** Someone dragged a task: this person's panel has a new order. */
  'chat:todos-reordered': (event: { assigneeId: string }) => void;
  'chat:read': (event: ChatReadEvent) => void;
  /** A message changed: deleted, or its reactions. */
  'chat:message-updated': (message: ChatMessageDTO) => void;
  /** Every message in a chat was erased by one of the two people. */
  'chat:cleared': (event: { conversationId: string }) => void;
  'presence:update': (presence: PresenceDTO[]) => void;
  'user:typing': (payload: { callId: string; userId: string; nickname: string }) => void;
  'session:revoked': () => void;
}

export interface ClientToServerEvents {
  'call:join': (payload: { callId: string }, ack?: (res: { ok: boolean; error?: string }) => void) => void;
  'call:leave': (payload: { callId: string }) => void;
  'user:typing': (payload: { callId: string }) => void;
  /** The tab is in use; sent on focus and at most once a minute while working. */
  'presence:active': () => void;
  /** The tab went to the background, or the person went idle. */
  'presence:away': () => void;
}
