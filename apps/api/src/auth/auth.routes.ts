import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { toUserDto } from '../users/users.service';
import * as authService from './auth.service';

export const authRouter = Router();

authRouter.post('/google', async (req, res) => {
  const { idToken } = z.object({ idToken: z.string().min(1) }).parse(req.body);
  const { token, user } = await authService.loginWithGoogle(idToken);
  res.json({ token, user: toUserDto(user) });
});

// Not in openapi.yaml: lets you test without a frontend. Only mounted when NODE_ENV=development.
if (config.isDev) {
  authRouter.post('/dev-login', async (req, res) => {
    const body = z.object({ email: z.email(), name: z.string().min(1).optional() }).parse(req.body);
    const { token, user } = await authService.login(
      body.email,
      body.name ?? body.email.split('@')[0],
    );
    res.json({ token, user: toUserDto(user) });
  });
}
