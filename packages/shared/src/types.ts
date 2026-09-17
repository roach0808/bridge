import type { AvatarAudience, AvatarStyle } from './avatars';
import type { CallStatus } from './callStatus';
import type { Role } from './roles';
import type { BlockRule, Occurrence } from './scheduleBlocks';
import type { ChatMessageKind, TodoStatus } from './chat';
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
  createdAt: string;
  updatedAt: string;
}

/** Only `/me` returns the email. */
export interface MeDTO extends UserDTO {
  email: string;
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
  bankCount: number | null;
  /** Founder only: the Profile has a booked call but no bank. */
  needsBank: boolean | null;
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
  /** Rate x actual duration (USD). Null until both are known, and always null for Experts. */
  expectedPrice: number | null;
  /** What reached the bank (USD), entered when processed to bank. Null for Experts. */
  realIncome: number | null;
  /** Added by the Expert when the call starts. */
  ninjaLink: string | null;
  /** Research link. Only the Founder (who sets it) and the Expert receive it. */
  gptLink: string | null;
  /** The Profile's rate on the call's platform, and this call's override. Null for Experts. */
  platformRate: number | null;
  rateOverride: number | null;
  /** Entered by the Expert when finishing. */
  actualDurationMinutes: number | null;
  /** 1–5, entered by the Expert when finishing. */
  rating: number | null;
  feedback: string | null;
  allowedTransitions: CallStatus[];
  permissions: CallPermissions;
  createdBy: UserRef;
  createdAt: string;
  updatedAt: string;
}

/** Server-computed, so clients never guess which controls to render. */
export interface CallPermissions {
  edit: boolean;
  reassignAssociate: boolean;
  reassignExpert: boolean;
  /** Founder only: correct the real income of a paid call. */
  editIncome: boolean;
  /** Founder only. */
  editGptLink: boolean;
  /** The call's Associate, their Manager, or the Founder. */
  editRate: boolean;
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
  | 'todo.assigned'
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
  replyTo: { id: string; body: string; sender: UserRef } | null;
  todo: TodoSummary | null;
  createdAt: string;
}

export interface ConversationDTO {
  id: string;
  other: UserRef & { isActive: boolean };
  lastMessage: Pick<ChatMessageDTO, 'id' | 'body' | 'kind' | 'createdAt'> & { senderId: string } | null;
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
  createdAt: string;
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
  'call:message': (message: MessageDTO) => void;
  'notification:new': (notification: NotificationDTO) => void;
  'chat:message': (message: ChatMessageDTO) => void;
  'chat:todo': (todo: TodoDTO | TodoRemovedEvent) => void;
  'chat:read': (event: ChatReadEvent) => void;
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
