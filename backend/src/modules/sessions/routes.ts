import { FastifyInstance } from 'fastify';
import { SessionPhase, SessionStatus } from '@prisma/client';
import { z } from 'zod';
import { sessionService } from './service.js';
import { jiraService } from '../jira/service.js';
import { ALLOWED_VOTES, NUMERIC_VOTES } from './constants.js';
import { getIo, sessionRoom } from '../../realtime.js';
import { prisma } from '../../prisma.js';

const createSessionSchema = z.object({
  name: z.string().min(2).max(120),
  tickets: z.array(
    z.object({
      jiraIssueKey: z.string().min(2),
      jiraIssueId: z.string().min(1),
      summary: z.string().min(1),
    }),
  ),
});

const voteSchema = z.object({
  value: z.enum(ALLOWED_VOTES as [string, ...string[]]),
});

const activateSchema = z.object({
  ticketId: z.string().min(1),
});

const assignSchema = z.object({
  storyPoints: z.number().int().min(1),
});

const setObserverSchema = z.object({
  isObserver: z.boolean(),
});

const transferHostSchema = z.object({
  userId: z.string().min(1),
});
const reactionSchema = z.object({
  emoji: z.string().min(1).max(8),
});
const reactionLastAtByKey = new Map<string, number>();
const REACTION_COOLDOWN_MS = 2000;
const participantPingAtByKey = new Map<string, number>();
const PARTICIPANT_PING_INTERVAL_MS = 10_000;
const PARTICIPANT_PING_TIMEOUT_MS = 60_000;

const participantHeartbeatKey = (sessionId: string, userId: string) => `${sessionId}:${userId}`;

const markParticipantPing = (sessionId: string, userId: string) => {
  participantPingAtByKey.set(participantHeartbeatKey(sessionId, userId), Date.now());
};

const clearParticipantPing = (sessionId: string, userId: string) => {
  participantPingAtByKey.delete(participantHeartbeatKey(sessionId, userId));
};

const computeVoteStats = (votes: Array<{ userId: string; value: string }>) => {
  const countsByValue: Record<string, number> = {};
  ALLOWED_VOTES.forEach((value) => {
    countsByValue[value] = 0;
  });

  const numericVotes: number[] = [];

  votes.forEach((vote) => {
    countsByValue[vote.value] = (countsByValue[vote.value] || 0) + 1;
    if (vote.value !== 'coffee') {
      const numeric = Number(vote.value);
      if (Number.isFinite(numeric)) {
        numericVotes.push(numeric);
      }
    }
  });

  if (numericVotes.length === 0) {
    return {
      countsByValue,
      minimum: null,
      maximum: null,
      average: null,
      suggestedStoryPoints: null,
    };
  }

  const minimum = Math.min(...numericVotes);
  const maximum = Math.max(...numericVotes);
  const average = numericVotes.reduce((sum, current) => sum + current, 0) / numericVotes.length;
  const suggestedStoryPoints = NUMERIC_VOTES.find((value) => value >= average) ?? 21;

  return {
    countsByValue,
    minimum,
    maximum,
    average,
    suggestedStoryPoints,
  };
};

const withSessionState = async (sessionId: string) => {
  const session = await sessionService.findById(sessionId);
  if (!session) {
    return null;
  }

  const activeTicket = session.tickets.find((ticket) => ticket.id === session.activeTicketId) ?? null;
  const votes =
    activeTicket &&
    (await prisma.sessionVote.findMany({
      where: { sessionId: session.id, ticketId: activeTicket.id },
    }));
  const votedUserIds = votes ? votes.map((vote) => vote.userId) : [];
  const activeVoterIds = new Set(
    session.participants.filter((participant) => !participant.isObserver).map((participant) => participant.userId),
  );
  const activeVotes = (votes || []).filter((vote) => activeVoterIds.has(vote.userId));
  const voteStats = computeVoteStats(activeVotes.map((vote) => ({ userId: vote.userId, value: vote.value })));
  const revealedVotes =
    session.phase === SessionPhase.REVEALED
      ? Object.fromEntries(activeVotes.map((vote) => [vote.userId, vote.value]))
      : null;
  const {
    jiraApiTokenEncrypted: _jiraApiTokenEncrypted,
    jiraBaseUrl: _jiraBaseUrl,
    jiraEmail: _jiraEmail,
    ...safeSession
  } = session;

  return {
    ...safeSession,
    activeTicket,
    votedUserIds,
    voteStats,
    revealedVotes,
    allowedVotes: ALLOWED_VOTES,
    numericVotes: NUMERIC_VOTES,
  };
};

const broadcastSession = async (sessionId: string) => {
  const io = getIo();
  const state = await withSessionState(sessionId);
  io.to(sessionRoom(sessionId)).emit('session:update', state);
};

const refreshAutoCloseTimer = async (sessionId: string) => {
  const session = await prisma.planningPokerSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      status: true,
      lastActivityAt: true,
      closingEndsAt: true,
    },
  });

  if (!session) {
    return;
  }

  sessionService.scheduleAutoClose(session, async (id) => {
    const current = await prisma.planningPokerSession.findUnique({ where: { id } });

    if (!current) {
      return;
    }

    if (current.status === SessionStatus.ACTIVE) {
      await sessionService.startClosing(id, 'inactivity');
      await refreshAutoCloseTimer(id);
    } else if (current.status === SessionStatus.CLOSING) {
      await sessionService.closeSession(id, 'inactivity');
    }

    await broadcastSession(id);
  });
};

const ensureAuthenticated = (request: { currentUser: unknown }) => {
  if (!request.currentUser) {
    throw new Error('UNAUTHORIZED');
  }
};

export const sessionRoutes = async (app: FastifyInstance) => {
  const cleanupStaleParticipants = async () => {
    const now = Date.now();
    const staleEntries = Array.from(participantPingAtByKey.entries()).filter(
      ([, lastPingAt]) => now - lastPingAt >= PARTICIPANT_PING_TIMEOUT_MS,
    );

    if (staleEntries.length === 0) {
      return;
    }

    const touchedSessionIds = new Set<string>();

    for (const [key] of staleEntries) {
      participantPingAtByKey.delete(key);

      const [sessionId, userId] = key.split(':');
      if (!sessionId || !userId) {
        continue;
      }

      const session = await sessionService.findById(sessionId);
      if (!session || session.status === SessionStatus.CLOSED) {
        continue;
      }

      const participant = session.participants.find((item) => item.userId === userId);
      if (!participant) {
        continue;
      }

      await sessionService.leaveSession(sessionId, userId);
      await refreshAutoCloseTimer(sessionId);
      touchedSessionIds.add(sessionId);
    }

    for (const sessionId of touchedSessionIds) {
      await broadcastSession(sessionId);
    }
  };

  const staleParticipantsInterval = setInterval(() => {
    cleanupStaleParticipants().catch((error) => {
      app.log.error(error, 'Failed to cleanup stale participants');
    });
  }, PARTICIPANT_PING_INTERVAL_MS);

  app.addHook('onClose', async () => {
    clearInterval(staleParticipantsInterval);
    participantPingAtByKey.clear();
  });

  app.get('/sessions/join/:code', async (request, reply) => {
    ensureAuthenticated(request);

    const params = z.object({ code: z.string().min(1) }).parse(request.params);
    const session = await sessionService.findByCode(params.code);

    if (!session) {
      return reply.code(404).send({ error: 'SESSION_NOT_FOUND' });
    }

    return { session };
  });

  app.post('/sessions', async (request, reply) => {
    ensureAuthenticated(request);

    const payload = createSessionSchema.parse(request.body);

    if (payload.tickets.length === 0) {
      return reply.code(422).send({ error: 'AT_LEAST_ONE_TICKET_REQUIRED' });
    }

    const host = await prisma.user.findUnique({
      where: { id: request.currentUser!.id },
      select: {
        jiraBaseUrl: true,
        jiraEmail: true,
        jiraApiTokenEncrypted: true,
      },
    });

    if (!host?.jiraBaseUrl || !host.jiraEmail || !host.jiraApiTokenEncrypted) {
      return reply.code(422).send({ error: 'JIRA_NOT_CONFIGURED' });
    }

    const session = await sessionService.createSession({
      name: payload.name,
      hostUserId: request.currentUser!.id,
      jiraSnapshot: {
        baseUrl: host.jiraBaseUrl,
        email: host.jiraEmail,
        apiTokenEncrypted: host.jiraApiTokenEncrypted,
      },
      tickets: payload.tickets,
    });

    await refreshAutoCloseTimer(session.id);
    await broadcastSession(session.id);
    return { session };
  });

  app.post('/sessions/:id/join', async (request, reply) => {
    ensureAuthenticated(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const session = await sessionService.findById(params.id);

    if (!session || session.status === SessionStatus.CLOSED) {
      return reply.code(404).send({ error: 'SESSION_NOT_FOUND' });
    }

    await sessionService.joinSession(session.id, request.currentUser!.id);
    markParticipantPing(session.id, request.currentUser!.id);
    await refreshAutoCloseTimer(session.id);
    await broadcastSession(session.id);

    return { ok: true };
  });

  app.post('/sessions/:id/leave', async (request, reply) => {
    ensureAuthenticated(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const session = await sessionService.findById(params.id);

    if (!session) {
      return reply.code(404).send({ error: 'SESSION_NOT_FOUND' });
    }

    await sessionService.leaveSession(session.id, request.currentUser!.id);
    clearParticipantPing(session.id, request.currentUser!.id);
    await refreshAutoCloseTimer(session.id);
    await broadcastSession(session.id);

    return { ok: true };
  });

  app.post('/sessions/:id/ping', async (request, reply) => {
    ensureAuthenticated(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const session = await sessionService.findById(params.id);

    if (!session || session.status === SessionStatus.CLOSED) {
      return reply.code(404).send({ error: 'SESSION_NOT_FOUND' });
    }

    const currentUserId = request.currentUser!.id;
    const participant = session.participants.find((item) => item.userId === currentUserId);
    if (!participant) {
      return reply.code(403).send({ error: 'NOT_IN_SESSION' });
    }

    markParticipantPing(session.id, currentUserId);
    return { ok: true };
  });

  app.get('/sessions/:id', async (request, reply) => {
    ensureAuthenticated(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const state = await withSessionState(params.id);

    if (!state) {
      return reply.code(404).send({ error: 'SESSION_NOT_FOUND' });
    }

    return { session: state };
  });

  app.get('/sessions/:id/issues/:issueKey', async (request, reply) => {
    ensureAuthenticated(request);
    const params = z.object({ id: z.string(), issueKey: z.string().min(2) }).parse(request.params);
    const session = await sessionService.findById(params.id);

    if (!session || session.status === SessionStatus.CLOSED) {
      return reply.code(404).send({ error: 'SESSION_NOT_FOUND' });
    }

    const currentUserId = request.currentUser!.id;
    const participant = session.participants.find((item) => item.userId === currentUserId);
    if (!participant) {
      return reply.code(403).send({ error: 'NOT_IN_SESSION' });
    }

    const normalizedIssueKey = params.issueKey.toUpperCase();
    const ticket = session.tickets.find((item) => item.jiraIssueKey.toUpperCase() === normalizedIssueKey);
    if (!ticket) {
      return reply.code(404).send({ error: 'TICKET_NOT_FOUND' });
    }

    const item = await jiraService.getIssueByKeyForSession(session, normalizedIssueKey);
    return { item };
  });

  app.post('/sessions/:id/observer', async (request, reply) => {
    ensureAuthenticated(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const payload = setObserverSchema.parse(request.body);
    const session = await sessionService.findById(params.id);

    if (!session) {
      return reply.code(404).send({ error: 'SESSION_NOT_FOUND' });
    }

    await sessionService.setObserver(session.id, request.currentUser!.id, payload.isObserver);
    await refreshAutoCloseTimer(session.id);
    await broadcastSession(session.id);

    return { ok: true };
  });

  app.post('/sessions/:id/activate-ticket', async (request, reply) => {
    ensureAuthenticated(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const payload = activateSchema.parse(request.body);
    const session = await sessionService.findById(params.id);

    if (!session) {
      return reply.code(404).send({ error: 'SESSION_NOT_FOUND' });
    }

    if (!sessionService.canManageSession(session, request.currentUser!)) {
      return reply.code(403).send({ error: 'NOT_ENOUGH_RIGHTS' });
    }

    const ticket = session.tickets.find((item) => item.id === payload.ticketId && !item.isDone);

    if (!ticket) {
      return reply.code(404).send({ error: 'TICKET_NOT_FOUND' });
    }

    await sessionService.activateTicket(session, ticket);
    await refreshAutoCloseTimer(session.id);
    await broadcastSession(session.id);

    return { ok: true };
  });

  app.post('/sessions/:id/vote', async (request, reply) => {
    ensureAuthenticated(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const payload = voteSchema.parse(request.body);
    const session = await sessionService.findById(params.id);

    if (!session) {
      return reply.code(404).send({ error: 'SESSION_NOT_FOUND' });
    }

    if (!session.activeTicketId || session.phase !== SessionPhase.VOTING) {
      return reply.code(422).send({ error: 'INVALID_STATE' });
    }

    const participant = session.participants.find((item) => item.userId === request.currentUser!.id);

    if (!participant || participant.isObserver) {
      return reply.code(403).send({ error: 'NOT_ENOUGH_RIGHTS' });
    }

    await sessionService.vote(session.id, session.activeTicketId, request.currentUser!.id, payload.value);
    await refreshAutoCloseTimer(session.id);
    await broadcastSession(session.id);

    return { ok: true };
  });

  app.post('/sessions/:id/reveal', async (request, reply) => {
    ensureAuthenticated(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const session = await sessionService.findById(params.id);

    if (!session) {
      return reply.code(404).send({ error: 'SESSION_NOT_FOUND' });
    }

    if (!sessionService.canManageSession(session, request.currentUser!)) {
      return reply.code(403).send({ error: 'NOT_ENOUGH_RIGHTS' });
    }

    if (!session.activeTicketId || session.phase !== SessionPhase.VOTING) {
      return reply.code(422).send({ error: 'INVALID_STATE' });
    }

    const stats = await sessionService.reveal(session);
    await refreshAutoCloseTimer(session.id);
    await broadcastSession(session.id);

    return { ok: true, stats };
  });

  app.post('/sessions/:id/restart-vote', async (request, reply) => {
    ensureAuthenticated(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const session = await sessionService.findById(params.id);

    if (!session) {
      return reply.code(404).send({ error: 'SESSION_NOT_FOUND' });
    }

    if (!sessionService.canManageSession(session, request.currentUser!)) {
      return reply.code(403).send({ error: 'NOT_ENOUGH_RIGHTS' });
    }

    if (session.phase !== SessionPhase.REVEALED) {
      return reply.code(422).send({ error: 'INVALID_STATE' });
    }

    await sessionService.restartVote(session);
    await refreshAutoCloseTimer(session.id);
    await broadcastSession(session.id);

    return { ok: true };
  });

  app.post('/sessions/:id/assign-story-points', async (request, reply) => {
    ensureAuthenticated(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const payload = assignSchema.parse(request.body);
    const session = await sessionService.findById(params.id);

    if (!session) {
      return reply.code(404).send({ error: 'SESSION_NOT_FOUND' });
    }

    if (!sessionService.canManageSession(session, request.currentUser!)) {
      return reply.code(403).send({ error: 'NOT_ENOUGH_RIGHTS' });
    }

    if (!session.activeTicketId || !NUMERIC_VOTES.includes(payload.storyPoints)) {
      return reply.code(422).send({ error: 'INVALID_STATE_OR_VALUE' });
    }

    const ticket = session.tickets.find((item) => item.id === session.activeTicketId);

    if (!ticket) {
      return reply.code(404).send({ error: 'TICKET_NOT_FOUND' });
    }

    const projectKey = ticket.jiraIssueKey.split('-')[0];

    await jiraService.assignStoryPointsForSession(session, ticket.jiraIssueKey, projectKey, payload.storyPoints);
    await sessionService.finishTicket(session, payload.storyPoints);
    await refreshAutoCloseTimer(session.id);
    await broadcastSession(session.id);

    return { ok: true };
  });

  app.post('/sessions/:id/skip-ticket', async (request, reply) => {
    ensureAuthenticated(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const session = await sessionService.findById(params.id);

    if (!session) {
      return reply.code(404).send({ error: 'SESSION_NOT_FOUND' });
    }

    if (!sessionService.canManageSession(session, request.currentUser!)) {
      return reply.code(403).send({ error: 'NOT_ENOUGH_RIGHTS' });
    }

    await sessionService.skipTicket(session);
    await refreshAutoCloseTimer(session.id);
    await broadcastSession(session.id);

    return { ok: true };
  });

  app.post('/sessions/:id/transfer-host', async (request, reply) => {
    ensureAuthenticated(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const payload = transferHostSchema.parse(request.body);
    const session = await sessionService.findById(params.id);

    if (!session) {
      return reply.code(404).send({ error: 'SESSION_NOT_FOUND' });
    }

    if (!sessionService.canManageSession(session, request.currentUser!)) {
      return reply.code(403).send({ error: 'NOT_ENOUGH_RIGHTS' });
    }

    const nextHost = session.participants.find((participant) => participant.userId === payload.userId);
    if (!nextHost) {
      return reply.code(404).send({ error: 'USER_NOT_IN_SESSION' });
    }

    await sessionService.transferHost(session.id, payload.userId);
    await refreshAutoCloseTimer(session.id);
    await broadcastSession(session.id);

    return { ok: true };
  });

  app.post('/sessions/:id/close', async (request, reply) => {
    ensureAuthenticated(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const session = await sessionService.findById(params.id);

    if (!session) {
      return reply.code(404).send({ error: 'SESSION_NOT_FOUND' });
    }

    if (!sessionService.canManageSession(session, request.currentUser!)) {
      return reply.code(403).send({ error: 'NOT_ENOUGH_RIGHTS' });
    }

    await sessionService.startClosing(session.id, 'manual');
    await refreshAutoCloseTimer(session.id);
    await broadcastSession(session.id);

    return { ok: true };
  });

  app.post('/sessions/:id/reaction', async (request, reply) => {
    ensureAuthenticated(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const payload = reactionSchema.parse(request.body);
    const session = await sessionService.findById(params.id);

    if (!session || session.status === SessionStatus.CLOSED) {
      return reply.code(404).send({ error: 'SESSION_NOT_FOUND' });
    }

    const currentUserId = request.currentUser!.id;
    const participant = session.participants.find((item) => item.userId === currentUserId);

    if (!participant) {
      return reply.code(403).send({ error: 'NOT_IN_SESSION' });
    }

    const now = Date.now();
    const cooldownKey = `${session.id}:${currentUserId}`;
    const previous = reactionLastAtByKey.get(cooldownKey) ?? 0;

    if (now - previous < REACTION_COOLDOWN_MS) {
      return reply.code(429).send({ error: 'REACTION_COOLDOWN' });
    }

    reactionLastAtByKey.set(cooldownKey, now);

    const io = getIo();
    io.to(sessionRoom(session.id)).emit('session:reaction', {
      sessionId: session.id,
      userId: currentUserId,
      emoji: payload.emoji,
      createdAt: new Date(now).toISOString(),
    });

    return { ok: true };
  });
};
