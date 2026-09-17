import { PHOTO_MAX_BYTES, photoUploadSchema } from '@god/shared';
import { decodeImageDataUrl } from '../images';
import { Router } from 'express';
import { actorOf, requireAuth, requireRole } from '../auth/middleware';
import { prisma, type Tx } from '../db';
import { badRequest, notFound } from '../errors';
import { idParam, param, parseBody } from '../http';
import { platformRefs } from '../profiles/profiles.routes';
import { meSelect, profileFounderCounts, profileInclude, toMeDTO, toProfileDTO } from '../serializers';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const decodePhoto = (dataUrl: string) => decodeImageDataUrl(dataUrl, PHOTO_MAX_BYTES);

/** Stores a new photo and removes the one it replaces, so old pictures never pile up. */
async function replacePhoto(
  tx: Tx,
  actorId: string,
  previousId: string | null,
  upload: { contentType: string; data: Buffer } | null,
  attach: (photoId: string | null) => Promise<unknown>,
) {
  const photo = upload
    ? await tx.photo.create({
        data: { contentType: upload.contentType, data: new Uint8Array(upload.data), byteSize: upload.data.length, createdById: actorId },
        select: { id: true },
      })
    : null;
  await attach(photo?.id ?? null);
  if (previousId) await tx.photo.deleteMany({ where: { id: previousId } });
}

export const photosRouter = Router();

// Public like catalog avatars: <img> tags cannot send tokens. Ids are random UUIDs.
photosRouter.get('/photos/:file', async (req, res) => {
  const id = param(req, 'file').replace(/\.\w+$/, '');
  if (!UUID_RE.test(id)) throw notFound('Photo');
  const photo = await prisma.photo.findUnique({ where: { id }, select: { contentType: true, data: true } });
  if (!photo) throw notFound('Photo');
  res
    .type(photo.contentType)
    .set('Cache-Control', 'public, max-age=31536000, immutable')
    .set('Cross-Origin-Resource-Policy', 'cross-origin')
    .send(Buffer.from(photo.data));
});

photosRouter.put('/me/photo', requireAuth, async (req, res) => {
  const actor = actorOf(req);
  const upload = decodePhoto(parseBody(photoUploadSchema, req).dataUrl);
  const me = await prisma.$transaction(async (tx) => {
    const current = await tx.user.findUniqueOrThrow({ where: { id: actor.id }, select: { photoId: true } });
    await replacePhoto(tx, actor.id, current.photoId, upload, (photoId) =>
      tx.user.update({ where: { id: actor.id }, data: { photoId } }),
    );
    return tx.user.findUniqueOrThrow({ where: { id: actor.id }, select: meSelect });
  });
  res.json(toMeDTO(me));
});

photosRouter.delete('/me/photo', requireAuth, async (req, res) => {
  const actor = actorOf(req);
  const me = await prisma.$transaction(async (tx) => {
    const current = await tx.user.findUniqueOrThrow({ where: { id: actor.id }, select: { photoId: true } });
    await replacePhoto(tx, actor.id, current.photoId, null, (photoId) =>
      tx.user.update({ where: { id: actor.id }, data: { photoId } }),
    );
    return tx.user.findUniqueOrThrow({ where: { id: actor.id }, select: meSelect });
  });
  res.json(toMeDTO(me));
});

async function setProfilePhoto(actorId: string, profileId: string | null, upload: ReturnType<typeof decodePhoto> | null) {
  if (!profileId) throw notFound('Profile');
  return prisma.$transaction(async (tx) => {
    const current = await tx.profile.findUnique({ where: { id: profileId }, select: { photoId: true } });
    if (!current) throw notFound('Profile');
    await replacePhoto(tx, actorId, current.photoId, upload, (photoId) =>
      tx.profile.update({ where: { id: profileId }, data: { photoId } }),
    );
    return tx.profile.findUniqueOrThrow({
      where: { id: profileId },
      include: { ...profileInclude, ...profileFounderCounts },
    });
  });
}

// Only the Founder edits profiles (§2.3), so only the Founder sets their pictures.
photosRouter.put('/profiles/:id/photo', requireAuth, requireRole('founder'), async (req, res) => {
  const upload = decodePhoto(parseBody(photoUploadSchema, req).dataUrl);
  res.json(toProfileDTO(await setProfilePhoto(actorOf(req).id, idParam(req), upload), await platformRefs()));
});

photosRouter.delete('/profiles/:id/photo', requireAuth, requireRole('founder'), async (req, res) => {
  res.json(toProfileDTO(await setProfilePhoto(actorOf(req).id, idParam(req), null), await platformRefs()));
});
