import {
  PlanningPokerSession,
  Prisma,
  SessionPhase,
  SessionStatus,
  SessionTicket,
  UserRole,
} from '@prisma/client';
import { prisma } from '../../prisma.js';
import { ALLOWED_VOTES, NUMERIC_VOTES } from './constants.js';
import { env } from '../../config.js';

const inactivityTimeoutBySessionId = new Map<string, NodeJS.Timeout>();
const finalizationTimeoutBySessionId = new Map<string, NodeJS.Timeout>();

const buildSessionCode = async () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)])
      .join('')
      .toUpperCase();
    const existing = await prisma.planningPokerSession.findUnique({ where: { code } });

    if (!existing) {
      return code;
    }
  }

  throw new Error('UNABLE_TO_GENERATE_SESSION_CODE');
};

const computeStats = (values: string[]) => {
  const countsByValue: Record<string, number> = {};

  ALLOWED_VOTES.forEach((value) => {
    countsByValue[value] = 0;
  });

  const numericValues: number[] = [];

  values.forEach((value) => {
    countsByValue[value] += 1;
    if (value !== 'coffee') {
      numericValues.push(Number(value));
    }
  });

  if (numericValues.length === 0) {
    return {
      countsByValue,
      minimum: null,
      maximum: null,
      average: null,
      suggestedStoryPoints: null,
    };
  }

  const minimum = Math.min(...numericValues);
  const maximum = Math.max(...numericValues);
  const average = numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length;
  const suggestedStoryPoints = NUMERIC_VOTES.find((value) => value >= average) ?? 21;

  return {
    countsByValue,
    minimum,
    maximum,
    average,
    suggestedStoryPoints,
  };
};

const clearTimers = (sessionId: string) => {
  const inactivityTimeout = inactivityTimeoutBySessionId.get(sessionId);
  if (inactivityTimeout) {
    clearTimeout(inactivityTimeout);
    inactivityTimeoutBySessionId.delete(sessionId);
  }

  const finalizationTimeout = finalizationTimeoutBySessionId.get(sessionId);
  if (finalizationTimeout) {
    clearTimeout(finalizationTimeout);
    finalizationTimeoutBySessionId.delete(sessionId);
  }
};

const isAdmin = (role: UserRole) => role === 'ADMIN';

export const sessionService = {
  async createSession(input: {
    name: string;
    hostUserId: string;
    jiraSnapshot: {
      baseUrl: string;
      email: string;
      apiTokenEncrypted: string;
    };
    tickets: Array<{ jiraIssueKey: string; jiraIssueId: string; summary: string }>;
  }) {
    const code = await buildSessionCode();

    const session = await prisma.planningPokerSession.create({
      data: {
        name: input.name,
        code,
        hostUserId: input.hostUserId,
        jiraBaseUrl: input.jiraSnapshot.baseUrl,
        jiraEmail: input.jiraSnapshot.email,
        jiraApiTokenEncrypted: input.jiraSnapshot.apiTokenEncrypted,
        participants: {
          create: {
            userId: input.hostUserId,
            isObserver: false,
          },
        },
        tickets: {
          create: input.tickets.map((ticket, index) => ({
            jiraIssueKey: ticket.jiraIssueKey.toUpperCase(),
            jiraIssueId: ticket.jiraIssueId,
            summary: ticket.summary,
            order: index + 1,
          })),
        },
      },
    });

    return session;
  },

  async findById(sessionId: string) {
    return prisma.planningPokerSession.findUnique({
      where: { id: sessionId },
      include: {
        participants: {
          where: { leftAt: null },
          include: { user: { select: { id: true, displayName: true, avatarDataUrl: true, role: true } } },
          orderBy: { joinedAt: 'asc' },
        },
        tickets: { orderBy: { order: 'asc' } },
      },
    });
  },

  async findByCode(code: string) {
    return prisma.planningPokerSession.findFirst({
      where: {
        code: code.toUpperCase(),
        status: { not: SessionStatus.CLOSED },
      },
      include: {
        participants: {
          where: { leftAt: null },
          include: { user: { select: { id: true, displayName: true, avatarDataUrl: true, role: true } } },
          orderBy: { joinedAt: 'asc' },
        },
        tickets: { orderBy: { order: 'asc' } },
      },
    });
  },

  async joinSession(sessionId: string, userId: string) {
    await prisma.sessionParticipant.upsert({
      where: {
        sessionId_userId: {
          sessionId,
          userId,
        },
      },
      create: {
        sessionId,
        userId,
      },
      update: {
        leftAt: null,
      },
    });

    await prisma.planningPokerSession.update({
      where: { id: sessionId },
      data: { lastActivityAt: new Date() },
    });
  },

  async leaveSession(sessionId: string, userId: string) {
    const session = await prisma.planningPokerSession.findUnique({
      where: { id: sessionId },
      select: { hostUserId: true, status: true },
    });

    await prisma.sessionParticipant.updateMany({
      where: {
        sessionId,
        userId,
      },
      data: {
        leftAt: new Date(),
      },
    });

    const activeParticipants = await prisma.sessionParticipant.count({
      where: {
        sessionId,
        leftAt: null,
      },
    });

    if (activeParticipants === 0) {
      await this.startClosing(sessionId, 'empty');
      return;
    }

    if (session?.hostUserId === userId && session.status !== SessionStatus.CLOSED) {
      const nextHostParticipant = await prisma.sessionParticipant.findFirst({
        where: {
          sessionId,
          leftAt: null,
        },
        orderBy: {
          joinedAt: 'asc',
        },
        select: {
          userId: true,
        },
      });

      if (nextHostParticipant) {
        await prisma.planningPokerSession.update({
          where: { id: sessionId },
          data: {
            hostUserId: nextHostParticipant.userId,
            lastActivityAt: new Date(),
          },
        });
      }
    }
  },

  async setObserver(sessionId: string, userId: string, isObserver: boolean) {
    await prisma.sessionParticipant.update({
      where: {
        sessionId_userId: {
          sessionId,
          userId,
        },
      },
      data: {
        isObserver,
      },
    });

    if (isObserver) {
      const session = await prisma.planningPokerSession.findUnique({ where: { id: sessionId } });
      if (session?.activeTicketId) {
        await prisma.sessionVote.deleteMany({
          where: {
            sessionId,
            ticketId: session.activeTicketId,
            userId,
          },
        });
      }
    }
  },

  async activateTicket(session: PlanningPokerSession, ticket: SessionTicket) {
    await prisma.sessionVote.deleteMany({
      where: {
        sessionId: session.id,
        ticketId: ticket.id,
      },
    });

    await prisma.sessionTicket.update({
      where: { id: ticket.id },
      data: { selectedAt: new Date() },
    });

    await prisma.planningPokerSession.update({
      where: { id: session.id },
      data: {
        phase: SessionPhase.VOTING,
        activeTicketId: ticket.id,
        status: SessionStatus.ACTIVE,
        closingStartedAt: null,
        closingEndsAt: null,
        lastActivityAt: new Date(),
      },
    });
  },

  async vote(sessionId: string, ticketId: string, userId: string, value: string) {
    if (!ALLOWED_VOTES.includes(value)) {
      throw new Error('INVALID_VOTE_VALUE');
    }

    await prisma.sessionVote.upsert({
      where: {
        sessionId_ticketId_userId: {
          sessionId,
          ticketId,
          userId,
        },
      },
      create: {
        sessionId,
        ticketId,
        userId,
        value,
      },
      update: {
        value,
      },
    });

    await prisma.planningPokerSession.update({
      where: { id: sessionId },
      data: { lastActivityAt: new Date() },
    });
  },

  async reveal(session: PlanningPokerSession) {
    if (!session.activeTicketId) {
      throw new Error('NO_ACTIVE_TICKET');
    }

    const participantVoters = await prisma.sessionParticipant.findMany({
      where: {
        sessionId: session.id,
        leftAt: null,
        isObserver: false,
      },
    });

    const voterIds = participantVoters.map((participant) => participant.userId);
    const votes = await prisma.sessionVote.findMany({
      where: {
        sessionId: session.id,
        ticketId: session.activeTicketId,
        userId: { in: voterIds },
      },
    });

    const stats = computeStats(votes.map((vote) => vote.value));

    await prisma.sessionAudit.create({
      data: {
        sessionId: session.id,
        eventType: 'VOTE_REVEALED',
        payload: stats as Prisma.InputJsonValue,
      },
    });

    await prisma.planningPokerSession.update({
      where: { id: session.id },
      data: {
        phase: SessionPhase.REVEALED,
        lastActivityAt: new Date(),
      },
    });

    return stats;
  },

  async restartVote(session: PlanningPokerSession) {
    if (!session.activeTicketId) {
      throw new Error('NO_ACTIVE_TICKET');
    }

    await prisma.sessionVote.deleteMany({
      where: {
        sessionId: session.id,
        ticketId: session.activeTicketId,
      },
    });

    await prisma.planningPokerSession.update({
      where: { id: session.id },
      data: {
        phase: SessionPhase.VOTING,
        lastActivityAt: new Date(),
      },
    });
  },

  async finishTicket(session: PlanningPokerSession, storyPoints: number) {
    if (!session.activeTicketId) {
      throw new Error('NO_ACTIVE_TICKET');
    }

    await prisma.sessionTicket.update({
      where: { id: session.activeTicketId },
      data: {
        isDone: true,
        finalStoryPoints: storyPoints,
        doneAt: new Date(),
      },
    });

    await prisma.planningPokerSession.update({
      where: { id: session.id },
      data: {
        phase: SessionPhase.IDLE,
        activeTicketId: null,
        lastActivityAt: new Date(),
      },
    });
  },

  async skipTicket(session: PlanningPokerSession) {
    if (!session.activeTicketId) {
      throw new Error('NO_ACTIVE_TICKET');
    }

    await prisma.planningPokerSession.update({
      where: { id: session.id },
      data: {
        phase: SessionPhase.IDLE,
        activeTicketId: null,
        lastActivityAt: new Date(),
      },
    });
  },

  async transferHost(sessionId: string, nextHostUserId: string) {
    await prisma.planningPokerSession.update({
      where: { id: sessionId },
      data: {
        hostUserId: nextHostUserId,
        lastActivityAt: new Date(),
      },
    });
  },

  async startClosing(sessionId: string, reason: 'manual' | 'inactivity' | 'empty') {
    const now = new Date();
    const closingEndsAt = new Date(now.getTime() + env.CLOSING_DURATION_MS);

    await prisma.planningPokerSession.update({
      where: { id: sessionId },
      data: {
        status: SessionStatus.CLOSING,
        phase: SessionPhase.CLOSING,
        activeTicketId: null,
        closingStartedAt: now,
        closingEndsAt,
      },
    });

    await prisma.sessionAudit.create({
      data: {
        sessionId,
        eventType: 'SESSION_CLOSING',
        payload: { reason } as Prisma.InputJsonValue,
      },
    });
  },

  async closeSession(sessionId: string, reason: 'manual' | 'inactivity' | 'empty') {
    clearTimers(sessionId);

    await prisma.planningPokerSession.update({
      where: { id: sessionId },
      data: {
        status: SessionStatus.CLOSED,
        phase: SessionPhase.CLOSING,
        closedAt: new Date(),
      },
    });

    await prisma.sessionAudit.create({
      data: {
        sessionId,
        eventType: 'SESSION_CLOSED',
        payload: { reason } as Prisma.InputJsonValue,
      },
    });
  },

  scheduleAutoClose(
    session: Pick<PlanningPokerSession, 'id' | 'status' | 'lastActivityAt' | 'closingEndsAt'>,
    onClose: (sessionId: string) => Promise<void>,
  ) {
    clearTimers(session.id);

    if (session.status === SessionStatus.CLOSED) {
      return;
    }

    if (session.status === SessionStatus.CLOSING && session.closingEndsAt) {
      const delay = Math.max(0, session.closingEndsAt.getTime() - Date.now());
      const timeout = setTimeout(() => {
        onClose(session.id).catch(() => {});
      }, delay);
      finalizationTimeoutBySessionId.set(session.id, timeout);

      return;
    }

    const delay = Math.max(0, session.lastActivityAt.getTime() + env.AUTO_CLOSE_AFTER_MS - Date.now());
    const timeout = setTimeout(async () => {
      const current = await prisma.planningPokerSession.findUnique({ where: { id: session.id } });

      if (!current || current.status !== SessionStatus.ACTIVE) {
        return;
      }

      if (current.lastActivityAt.getTime() + env.AUTO_CLOSE_AFTER_MS > Date.now()) {
        this.scheduleAutoClose(current, onClose);
        return;
      }

      await this.startClosing(current.id, 'inactivity');
      onClose(current.id).catch(() => {});
    }, delay);

    inactivityTimeoutBySessionId.set(session.id, timeout);
  },

  canManageSession(session: PlanningPokerSession, user: { id: string; role: UserRole }) {
    return session.hostUserId === user.id || isAdmin(user.role);
  },
};
