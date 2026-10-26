import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';
import { authRouter } from './auth/auth.routes';
import { authenticate } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { usersRouter } from './users/users.routes';

const spec = YAML.parse(fs.readFileSync(path.resolve(__dirname, '../../../openapi.yaml'), 'utf8'));

export const app = express();
app.use(express.json());

const api = express.Router();
api.use('/docs', swaggerUi.serve, swaggerUi.setup(spec));
api.use('/auth', authRouter);
// Everything below requires a valid JWT.
api.use(authenticate);
api.use('/users', usersRouter);
app.use('/api', api);

app.use(notFoundHandler);
app.use(errorHandler);
