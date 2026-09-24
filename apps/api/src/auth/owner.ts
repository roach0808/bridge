import { config } from '../config';
import { prisma } from '../db';
import { forbidden } from '../errors';

/**
 * The one Founder who owns the system (`OWNER_EMAIL`). A few things are theirs
 * alone — which device an audit entry came from, and reading everyone's chats —
 * so another Founder, who can otherwise see the whole trail, does not see them.
 */
export const isOwnerEmail = (email: string | null): boolean =>
  email != null && email.toLowerCase() === config.OWNER_EMAIL.toLowerCase();

export async function isOwner(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return isOwnerEmail(user?.email ?? null);
}

/** Guards what only the owner may see; anyone else is refused. */
export async function requireOwner(userId: string): Promise<void> {
  if (!(await isOwner(userId))) throw forbidden('Only the owner of the system can do this');
}
