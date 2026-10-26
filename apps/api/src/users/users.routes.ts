import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/auth';
import * as usersService from './users.service';

export const usersRouter = Router();

usersRouter.get('/me', (req, res) => {
  res.json(usersService.toUserDto(req.user));
});

usersRouter.get('/', requireAdmin, async (req, res) => {
  const q = z
    .object({
      role: z.enum(['STUDENT', 'TEACHER', 'ADMIN']).optional(),
      blocked: z
        .enum(['true', 'false'])
        .transform((v) => v === 'true')
        .optional(),
      search: z.string().trim().min(1).optional(),
    })
    .parse(req.query);
  res.json(await usersService.list(q));
});

usersRouter.patch('/:userId/block', requireAdmin, async (req, res) => {
  const userId = z.uuid().parse(req.params.userId);
  const { blocked } = z.object({ blocked: z.boolean() }).parse(req.body);
  res.json(await usersService.setBlocked(userId, blocked));
});
