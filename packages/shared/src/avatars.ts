import type { Role } from './roles';

export const AVATAR_AUDIENCES = ['founder', 'manager', 'associate', 'expert', 'profile'] as const;
export type AvatarAudience = (typeof AVATAR_AUDIENCES)[number];

export const AVATAR_STYLES = ['notionists', 'toonHead', 'bigSmile', 'openPeeps', 'personas'] as const;
export type AvatarStyle = (typeof AVATAR_STYLES)[number];

export interface AvatarDefinition {
  id: string;
  audience: AvatarAudience;
  style: AvatarStyle;
  seed: string;
  background: string;
  label: string;
  sortOrder: number;
}

interface AudienceTheme {
  style: AvatarStyle;
  mood: string;
  backgrounds: string[];
}

export const AUDIENCE_THEMES: Record<AvatarAudience, AudienceTheme> = {
  founder: {
    style: 'notionists',
    mood: 'Executive',
    backgrounds: ['#e8e4dc', '#dcd6ca', '#f1ede4', '#d9dee4', '#e5e1ea', '#dfe6de'],
  },
  manager: {
    style: 'personas',
    mood: 'Professional',
    backgrounds: ['#c7d7f2', '#d4e2f7', '#bfd0ea', '#d0e4ee', '#cfd8e8', '#dde7f5'],
  },
  associate: {
    style: 'bigSmile',
    mood: 'Funny',
    backgrounds: ['#ffd8a8', '#ffe066', '#b2f2bb', '#a5d8ff', '#fcc2d7', '#d0bfff'],
  },
  expert: {
    style: 'openPeeps',
    mood: 'Characterful',
    backgrounds: ['#c3fae8', '#ffec99', '#ffc9c9', '#d3f9d8', '#e5dbff', '#ffe8cc'],
  },
  profile: {
    style: 'toonHead',
    mood: 'Portrait',
    backgrounds: ['#e9ecef', '#dee2e6', '#f1f3f5', '#e3e7ea', '#eceff1', '#e6e9ec'],
  },
};

const SEEDS = [
  'Aurora', 'Basil', 'Cedar', 'Delta', 'Echo', 'Fable', 'Garnet', 'Harbor',
  'Indigo', 'Juniper', 'Kestrel', 'Lumen', 'Maple', 'Nova', 'Onyx', 'Pepper',
  'Quartz', 'Rowan', 'Sable', 'Tango', 'Umber', 'Vesper', 'Willow', 'Zephyr',
];

export const AVATARS_PER_AUDIENCE = 24;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function buildAvatarCatalog(): AvatarDefinition[] {
  const out: AvatarDefinition[] = [];
  for (const audience of AVATAR_AUDIENCES) {
    const theme = AUDIENCE_THEMES[audience];
    for (let i = 1; i <= AVATARS_PER_AUDIENCE; i++) {
      out.push({
        id: `${audience}-${pad(i)}`,
        audience,
        style: theme.style,
        seed: `${audience}-${SEEDS[i - 1]}`,
        background: theme.backgrounds[(i - 1) % theme.backgrounds.length]!,
        label: `${theme.mood} ${pad(i)}`,
        sortOrder: i,
      });
    }
  }
  return out;
}

export const AVATAR_CATALOG: AvatarDefinition[] = buildAvatarCatalog();

export function avatarAudienceForRole(role: Role): AvatarAudience {
  return role;
}

export function isAvatarForAudience(avatarId: string, audience: AvatarAudience): boolean {
  return AVATAR_CATALOG.some((a) => a.id === avatarId && a.audience === audience);
}

export function defaultAvatarFor(audience: AvatarAudience): string {
  return `${audience}-01`;
}

export const AVATAR_CREDITS = [
  { style: 'Notionists', author: 'Zoish', license: 'CC0' },
  { style: 'ToonHead', author: 'Johan Melin', license: 'CC BY 4.0' },
  { style: 'Big Smile', author: 'Ashley Seo', license: 'CC BY 4.0' },
  { style: 'Open Peeps', author: 'Pablo Stanley', license: 'CC0' },
  { style: 'Personas', author: 'Draftbit', license: 'CC BY 4.0' },
] as const;
