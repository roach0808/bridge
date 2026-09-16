import { Router } from 'express';
import { actorOf, requireAuth } from '../auth/middleware';
import { presenceFor } from '../realtime/presence';

export const presenceRouter = Router();

/** Online / away / offline for everyone the caller may chat with (§7.6). */
presenceRouter.get('/presence', requireAuth, async (req, res) => {
  res.json(await presenceFor(actorOf(req)));
});
