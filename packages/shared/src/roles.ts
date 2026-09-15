export const ROLES = ['founder', 'manager', 'associate', 'expert'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  founder: 'Founder',
  manager: 'Manager',
  associate: 'Associate',
  expert: 'Expert',
};

/** Which roles each role may create (§2.3). */
export const CREATABLE_ROLES: Record<Role, readonly Role[]> = {
  founder: ['manager', 'associate', 'expert'],
  manager: ['associate'],
  associate: [],
  expert: [],
};

export const TEAM_TIME_ZONE = 'America/New_York';
