/** Whether someone is at their screen right now (§7.6). */
export const PRESENCE_STATUSES = ['online', 'away', 'offline'] as const;
export type PresenceStatus = (typeof PRESENCE_STATUSES)[number];

export const PRESENCE_LABELS: Record<PresenceStatus, string> = {
  online: 'Online',
  // Still on the platform, just idle: shown as online, with the reason in the tooltip.
  away: 'Online (idle)',
  offline: 'Offline',
};

/** Connected but idle (or in a background tab) for this long counts as away. */
export const AWAY_AFTER_MS = 5 * 60_000;
