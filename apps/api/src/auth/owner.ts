import { config } from '../config';
import { prisma } from '../db';

/**
 * The one Founder who owns the system (`OWNER_EMAIL`). A few things are theirs
 * alone — which device an audit entry came from — so another Founder, who can
 * otherwise see the whole trail, does not see them.
 */
export async function isOwner(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return user?.email != null && user.email.toLowerCase() === config.OWNER_EMAIL.toLowerCase();
}
