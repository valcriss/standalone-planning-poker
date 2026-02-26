import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { Server as SocketIOServer } from 'socket.io';
import { SessionStatus } from '@prisma/client';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { env } from './config.js';
import { registerAuthPlugin } from './plugins/authenticate.js';
import { authRoutes } from './modules/auth/routes.js';
import { sessionRoutes } from './modules/sessions/routes.js';
import { jiraRoutes } from './modules/jira/routes.js';
import { adminRoutes } from './modules/admin/routes.js';
import { setIo, sessionRoom } from './realtime.js';
import { sessionService } from './modules/sessions/service.js';
import { prisma } from './prisma.js';

export const buildApp = async () => {
  const app = Fastify({ logger: true });
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const frontendDistPath = path.resolve(__dirname, '../../frontend-dist');

  await app.register(cors, {
    origin: env.APP_BASE_URL,
    credentials: true,
  });
  await app.register(cookie);
  await registerAuthPlugin(app);

  app.get('/health', async () => ({ ok: true }));
  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(jiraRoutes);
      await api.register(adminRoutes);
      await api.register(sessionRoutes);
    },
    { prefix: '/api' },
  );

  if (existsSync(frontendDistPath)) {
    await app.register(fastifyStatic, {
      root: frontendDistPath,
      wildcard: false,
    });

    app.get('/login', async (_, reply) => reply.sendFile('index.html'));
    app.get('/session/:code', async (_, reply) => reply.sendFile('index.html'));
    app.get('/join/:code', async (_, reply) => reply.sendFile('index.html'));
    app.get('/sessions/:id', async (_, reply) => reply.sendFile('index.html'));

    app.setNotFoundHandler(async (request, reply) => {
      const method = request.method.toUpperCase();
      const url = request.raw.url ?? '';
      const accept = String(request.headers.accept ?? '');
      const acceptsHtml = accept.includes('text/html');

      if (
        (method === 'GET' || method === 'HEAD') &&
        !url.startsWith('/api') &&
        !url.startsWith('/socket.io') &&
        acceptsHtml
      ) {
        return reply.sendFile('index.html');
      }

      return reply.code(404).send({ error: 'NOT_FOUND' });
    });
  }

  app.setErrorHandler((error, _, reply) => {
    const err = error as Error;

    app.log.error(error);

    if (err.message === 'UNAUTHORIZED') {
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }

    if (
      err.message === 'INVALID_CREDENTIALS' ||
      err.message === 'INVALID_REFRESH_TOKEN' ||
      err.message === 'EMAIL_ALREADY_EXISTS'
    ) {
      return reply.code(400).send({ error: err.message });
    }

    if (err.message === 'JIRA_NOT_CONFIGURED') {
      return reply.code(422).send({ error: err.message });
    }

    if (
      err.message === 'OIDC_NOT_CONFIGURED' ||
      err.message === 'OIDC_EMAIL_MISSING' ||
      err.message === 'INVALID_OIDC_STATE'
    ) {
      return reply.code(400).send({ error: err.message });
    }

    return reply.code(500).send({ error: 'INTERNAL_SERVER_ERROR' });
  });

  const io = new SocketIOServer(app.server, {
    cors: {
      origin: env.APP_BASE_URL,
      credentials: true,
    },
  });

  setIo(io);

  io.on('connection', (socket) => {
    socket.on('session:join-room', (payload: { sessionId: string }) => {
      if (payload?.sessionId) {
        socket.join(sessionRoom(payload.sessionId));
      }
    });

    socket.on('session:leave-room', (payload: { sessionId: string }) => {
      if (payload?.sessionId) {
        socket.leave(sessionRoom(payload.sessionId));
      }
    });
  });

  const bootSessions = await prisma.planningPokerSession.findMany({
    where: { status: { in: [SessionStatus.ACTIVE, SessionStatus.CLOSING] } },
    select: {
      id: true,
      status: true,
      lastActivityAt: true,
      closingEndsAt: true,
    },
  });

  for (const session of bootSessions) {
    sessionService.scheduleAutoClose(session, async (sessionId) => {
      const reloaded = await sessionService.findById(sessionId);
      if (!reloaded) {
        return;
      }

      if (reloaded.status === SessionStatus.CLOSING) {
        await sessionService.closeSession(sessionId, 'inactivity');
      } else if (reloaded.status === SessionStatus.ACTIVE) {
        await sessionService.startClosing(sessionId, 'inactivity');
      }

      io.to(sessionRoom(sessionId)).emit('session:update', await sessionService.findById(sessionId));
    });
  }

  return { app };
};
