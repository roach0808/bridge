import type { AvatarAudience, AvatarStyle } from './avatars';
import type { CallStatus } from './callStatus';
import type { Role } from './roles';
import type { BlockRule, Occurrence } from './scheduleBlocks';
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
  /** Founder only (null for others). */
  currentAddress: string | null;
  avatarId: string;
  photoId: string | null;
  status: ProfileStatus;
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
  invoiceAmount: string | null;
  invoiceCurrency: string | null;
  /** Added by the Expert when the call starts. */
  ninjaLink: string | null;
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
  editInvoice: boolean;
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

export type NotificationType =
  | 'call.status_changed'
  | 'call.assigned'
  | 'call.message'
  | 'call.updated'
  | 'call.created'
  | 'profile.submitted'
  | 'profile.approved'
  | 'profile.rejected';

export interface NotificationPayload {
  callId?: string;
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
  };
  /** Founder only. */
  database?: {
    sizeBytes: number;
    tables: Array<{ name: string; bytes: number; rows: number }>;
  };
}

// --- Socket events (§7) -----------------------------------------------------

export interface ServerToClientEvents {
  'call:updated': (call: CallDTO) => void;
  'call:message': (message: MessageDTO) => void;
  'notification:new': (notification: NotificationDTO) => void;
  'user:typing': (payload: { callId: string; userId: string; nickname: string }) => void;
  'session:revoked': () => void;
}

export interface ClientToServerEvents {
  'call:join': (payload: { callId: string }, ack?: (res: { ok: boolean; error?: string }) => void) => void;
  'call:leave': (payload: { callId: string }) => void;
  'user:typing': (payload: { callId: string }) => void;
}
