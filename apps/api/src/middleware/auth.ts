import type { User } from '@prisma/client';
import type { RequestHandler } from 'express';
import { verifyToken } from '../auth/auth.service';
import { accountBlocked, forbidden, unauthorized } from '../lib/errors';
import * as usersRepo from '../users/users.repository';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user: User;
    }
  }
}

/** Verifies the JWT and reloads the user, so blocking takes effect on the next request. */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const [scheme, token] = req.headers.authorization?.split(' ') ?? [];
  if (scheme !== 'Bearer' || !token) throw unauthorized();
  const user = await usersRepo.findById(verifyToken(token));
  if (!user) throw unauthorized();
  if (user.blocked) throw accountBlocked();
  req.user = user;
  next();
};

export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (req.user.role !== 'ADMIN') throw forbidden();
  next();
};
