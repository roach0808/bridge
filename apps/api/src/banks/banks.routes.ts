import { bankSchema, updateBankSchema, type BankDTO } from '@god/shared';
import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { actorOf, requireAuth, requireRole } from '../auth/middleware';
import { prisma, type Tx } from '../db';
import { notFound } from '../errors';
import { idParam, iso, parseBody } from '../http';

const toBankDTO = (b: Prisma.ProfileBankGetPayload<object>): BankDTO => ({
  id: b.id,
  profileId: b.profileId,
  bankName: b.bankName,
  accountHolder: b.accountHolder,
  accountNumber: b.accountNumber,
  swiftBic: b.swiftBic,
  routingNumber: b.routingNumber,
  country: b.country,
  currency: b.currency,
  notes: b.notes,
  isPrimary: b.isPrimary,
  createdAt: iso(b.createdAt),
  updatedAt: iso(b.updatedAt),
});

const bankOrder: Prisma.ProfileBankOrderByWithRelationInput[] = [{ isPrimary: 'desc' }, { createdAt: 'asc' }];

/** Keeps exactly one primary bank whenever a profile has any. */
async function settlePrimary(tx: Tx, profileId: string, primaryId?: string) {
  if (primaryId) {
    await tx.profileBank.updateMany({ where: { profileId, isPrimary: true, NOT: { id: primaryId } }, data: { isPrimary: false } });
    await tx.profileBank.update({ where: { id: primaryId }, data: { isPrimary: true } });
    return;
  }
  const hasPrimary = await tx.profileBank.count({ where: { profileId, isPrimary: true } });
  if (!hasPrimary) {
    const first = await tx.profileBank.findFirst({ where: { profileId }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (first) await tx.profileBank.update({ where: { id: first.id }, data: { isPrimary: true } });
  }
}

/**
 * Bank details are payment data. The Founder owns the invoicing stages, so only
 * the Founder reads or changes them.
 */
export const banksRouter = Router();

banksRouter.get('/profiles/:id/banks', requireAuth, requireRole('founder'), async (req, res) => {
  const id = idParam(req);
  if (!id || !(await prisma.profile.count({ where: { id } }))) throw notFound('Profile');
  const banks = await prisma.profileBank.findMany({ where: { profileId: id }, orderBy: bankOrder });
  res.json(banks.map(toBankDTO));
});

banksRouter.post('/profiles/:id/banks', requireAuth, requireRole('founder'), async (req, res) => {
  const actor = actorOf(req);
  const profileId = idParam(req);
  if (!profileId || !(await prisma.profile.count({ where: { id: profileId } }))) throw notFound('Profile');
  const { isPrimary, ...input } = parseBody(bankSchema, req);
  const bank = await prisma.$transaction(async (tx) => {
    const created = await tx.profileBank.create({ data: { ...input, isPrimary: false, profileId, createdById: actor.id } });
    await settlePrimary(tx, profileId, isPrimary ? created.id : undefined);
    return tx.profileBank.findUniqueOrThrow({ where: { id: created.id } });
  });
  res.status(201).json(toBankDTO(bank));
});

banksRouter.patch('/banks/:id', requireAuth, requireRole('founder'), async (req, res) => {
  const id = idParam(req);
  const current = id ? await prisma.profileBank.findUnique({ where: { id } }) : null;
  if (!current) throw notFound('Bank');
  const { isPrimary, ...input } = parseBody(updateBankSchema, req);
  const bank = await prisma.$transaction(async (tx) => {
    await tx.profileBank.update({ where: { id: current.id }, data: { ...input, ...(isPrimary === false ? { isPrimary: false } : {}) } });
    await settlePrimary(tx, current.profileId, isPrimary ? current.id : undefined);
    return tx.profileBank.findUniqueOrThrow({ where: { id: current.id } });
  });
  res.json(toBankDTO(bank));
});

banksRouter.delete('/banks/:id', requireAuth, requireRole('founder'), async (req, res) => {
  const id = idParam(req);
  const current = id ? await prisma.profileBank.findUnique({ where: { id } }) : null;
  if (!current) throw notFound('Bank');
  await prisma.$transaction(async (tx) => {
    await tx.profileBank.delete({ where: { id: current.id } });
    await settlePrimary(tx, current.profileId);
  });
  res.status(204).end();
});
