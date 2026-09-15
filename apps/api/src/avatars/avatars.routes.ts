import { createAvatar, type Style } from '@dicebear/core';
import { bigSmile, notionists, openPeeps, personas, toonHead } from '@dicebear/collection';
import { AVATAR_CATALOG, avatarQuerySchema, type AvatarDTO, type AvatarDefinition, type AvatarStyle } from '@god/shared';
import { Router } from 'express';
import { requireAuth } from '../auth/middleware';
import { config } from '../config';
import { notFound } from '../errors';
import { param, parseQuery } from '../http';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const STYLES: Record<AvatarStyle, Style<any>> = { notionists, toonHead, bigSmile, openPeeps, personas };

const svgCache = new Map<string, string>();

export function renderAvatar(avatar: AvatarDefinition): string {
  let svg = svgCache.get(avatar.id);
  if (!svg) {
    svg = createAvatar(STYLES[avatar.style], {
      seed: avatar.seed,
      backgroundColor: [avatar.background.replace('#', '')],
      backgroundType: ['solid'],
      radius: 0,
      size: 128,
    }).toString();
    svgCache.set(avatar.id, svg);
  }
  return svg;
}

const byId = new Map(AVATAR_CATALOG.map((a) => [a.id, a]));

export const avatarUrl = (id: string) => `${config.PUBLIC_API_URL}/api/v1/avatars/${id}.svg`;

const toAvatarDTO = (a: AvatarDefinition): AvatarDTO => ({ ...a, url: `/api/v1/avatars/${a.id}.svg` });

export const avatarsRouter = Router();

// Public: <img> tags cannot send bearer tokens. The picture reveals nothing.
avatarsRouter.get('/avatars/:file', (req, res, next) => {
  const file = param(req, 'file');
  if (!file.endsWith('.svg')) return next();
  const avatar = byId.get(file.slice(0, -4));
  if (!avatar) throw notFound('Avatar');
  res
    .type('image/svg+xml')
    .set('Cache-Control', 'public, max-age=31536000, immutable')
    .set('Cross-Origin-Resource-Policy', 'cross-origin')
    .send(renderAvatar(avatar));
});

avatarsRouter.get('/avatars', requireAuth, (req, res) => {
  const { audience } = parseQuery(avatarQuerySchema, req);
  const list = AVATAR_CATALOG.filter((a) => !audience || a.audience === audience)
    .sort((a, b) => a.audience.localeCompare(b.audience) || a.sortOrder - b.sortOrder)
    .map(toAvatarDTO);
  res.json(list);
});
