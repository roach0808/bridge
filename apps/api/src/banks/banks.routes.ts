import { bankSchema, updateBankSchema, type BankDTO, type BankListItem, type Role } from '@god/shared';
import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { actorOf, requireAuth, requireRole, type Actor } from '../auth/middleware';
import { prisma } from '../db';
import { conflict, notFound } from '../errors';
import { idParam, iso, parseBody } from '../http';
import { visibleProfilesWhere } from '../profiles/profiles.routes';
import { decryptSecret, encryptSecret } from './secret';

type BankRow = Prisma.ProfileBankGetPayload<object>;

/** The login secrets (password, where it is signed in) are the Founder's alone. */
export const toBankDTO = (b: BankRow, viewer: { role: Role }): BankDTO => {
  const founder = viewer.role === 'founder';
  return {
    id: b.id,
    profileId: b.profileId,
    nickname: b.nickname,
    bankType: b.bankType,
    bankName: b.bankName,
    bankAddress: b.bankAddress,
    routingNumber: b.routingNumber,
    accountNumber: b.accountNumber,
    swiftCode: b.swiftCode,
    email: b.email,
    hasPassword: founder ? b.passwordEnc !== null : null,
    signInLocation: founder ? b.signInLocation : null,
    isActive: b.isActive,
    createdAt: iso(b.createdAt),
    updatedAt: iso(b.updatedAt),
  };
};

const bankOrder: Prisma.ProfileBankOrderByWithRelationInput[] = [{ isActive: 'desc' }, { createdAt: 'asc' }];

/** An empty password removes it; leaving it out keeps the saved one. */
const passwordData = (password: string | null | undefined) =>
  password === undefined ? {} : { passwordEnc: password ? encryptSecret(password) : null };

async function loadProfile(actor: Actor, id: string | null) {
  const profile = id ? await prisma.profile.findFirst({ where: { AND: [{ id }, visibleProfilesWhere(actor)] }, select: { id: true } }) : null;
  if (!profile) throw notFound('Profile');
  return profile;
}

async function loadBank(id: string | null) {
  const bank = id ? await prisma.profileBank.findUnique({ where: { id } }) : null;
  if (!bank) throw notFound('Bank');
  return bank;
}

/**
 * Bank accounts are payment data. The Founder manages them and sees every field;
 * Managers and Associates read the banks of the Profiles they can see, without
 * the login secrets; Experts get nothing (§2.3).
 */
export const banksRouter = Router();

banksRouter.get('/profiles/:id/banks', requireAuth, requireRole('founder', 'manager', 'associate'), async (req, res) => {
  const actor = actorOf(req);
  const profile = await loadProfile(actor, idParam(req));
  const banks = await prisma.profileBank.findMany({ where: { profileId: profile.id }, orderBy: bankOrder });
  res.json(banks.map((b) => toBankDTO(b, actor)));
});

banksRouter.post('/profiles/:id/banks', requireAuth, requireRole('founder'), async (req, res) => {
  const actor = actorOf(req);
  const profile = await loadProfile(actor, idParam(req));
  const { password, ...input } = parseBody(bankSchema, req);
  const bank = await prisma.profileBank.create({
    data: { ...input, ...passwordData(password), profileId: profile.id, createdById: actor.id },
  });
  res.status(201).json(toBankDTO(bank, actor));
});

/** The Founder's bank page: every bank of every Profile. */
banksRouter.get('/banks', requireAuth, requireRole('founder'), async (req, res) => {
  const actor = actorOf(req);
  const banks = await prisma.profileBank.findMany({
    where: { profile: { deletedAt: null } },
    include: { profile: { select: { id: true, name: true, isActive: true } } },
    orderBy: [{ isActive: 'desc' }, { profile: { name: 'asc' } }, { createdAt: 'asc' }],
  });
  const body: BankListItem[] = banks.map((b) => ({ ...toBankDTO(b, actor), profile: b.profile }));
  res.json(body);
});

/** The bank types already in use, most used first: suggestions for the free-text field. */
banksRouter.get('/banks/types', requireAuth, requireRole('founder'), async (_req, res) => {
  const rows = await prisma.profileBank.groupBy({ by: ['bankType'], _count: { _all: true }, orderBy: { _count: { bankType: 'desc' } } });
  res.json(rows.map((r) => r.bankType).filter((t) => t !== 'Unknown'));
});

/** Reveals the saved password. Each reveal is written to the audit trail. */
banksRouter.get('/banks/:id/password', requireAuth, requireRole('founder'), async (req, res) => {
  const bank = await loadBank(idParam(req));
  if (!bank.passwordEnc) return res.json({ password: null });
  const password = decryptSecret(bank.passwordEnc);
  if (password === null) throw conflict('This password cannot be read with the current encryption key; enter it again', 'secret_unreadable');
  res.json({ password });
});

banksRouter.patch('/banks/:id', requireAuth, requireRole('founder'), async (req, res) => {
  const actor = actorOf(req);
  const current = await loadBank(idParam(req));
  const { password, ...input } = parseBody(updateBankSchema, req);
  const bank = await prisma.profileBank.update({ where: { id: current.id }, data: { ...input, ...passwordData(password) } });
  res.json(toBankDTO(bank, actor));
});

banksRouter.delete('/banks/:id', requireAuth, requireRole('founder'), async (req, res) => {
  const current = await loadBank(idParam(req));
  const invoices = await prisma.call.count({ where: { bankId: current.id } });
  if (invoices) {
    throw conflict(
      `${invoices} invoice${invoices === 1 ? ' was' : 's were'} submitted to this bank; deactivate it instead`,
      'bank_in_use',
      { invoices },
    );
  }
  await prisma.profileBank.delete({ where: { id: current.id } });
  res.status(204).end();
});
