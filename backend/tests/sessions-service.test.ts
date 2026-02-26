const prismaMock = {
  planningPokerSession: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  sessionParticipant: {
    upsert: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  sessionVote: {
    upsert: jest.fn(),
    deleteMany: jest.fn(),
    findMany: jest.fn(),
  },
  sessionAudit: {
    create: jest.fn(),
  },
  sessionTicket: {
    update: jest.fn(),
  },
};

jest.mock('../src/prisma.js', () => ({
  prisma: prismaMock,
}));

jest.mock('../src/config.js', () => ({
  env: {
    AUTO_CLOSE_AFTER_MS: 10,
    CLOSING_DURATION_MS: 20,
  },
}));

import { sessionService } from '../src/modules/sessions/service.js';

describe('sessionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('creates session with generated unique code and normalized jira issue keys', async () => {
    prismaMock.planningPokerSession.findUnique.mockResolvedValueOnce(null);
    prismaMock.planningPokerSession.create.mockResolvedValueOnce({ id: 's1' });

    await sessionService.createSession({
      name: 'Sprint Planning',
      hostUserId: 'u1',
      jiraSnapshot: { baseUrl: 'https://jira.example.com', email: 'jira@example.com', apiTokenEncrypted: 'enc' },
      tickets: [
        { jiraIssueKey: 'abc-1', jiraIssueId: '10001', summary: 'Ticket 1' },
        { jiraIssueKey: 'def-2', jiraIssueId: '10002', summary: 'Ticket 2' },
      ],
    });

    expect(prismaMock.planningPokerSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tickets: {
            create: [
              expect.objectContaining({ jiraIssueKey: 'ABC-1', order: 1 }),
              expect.objectContaining({ jiraIssueKey: 'DEF-2', order: 2 }),
            ],
          },
        }),
      }),
    );
  });

  it('throws when unable to generate a unique session code', async () => {
    prismaMock.planningPokerSession.findUnique.mockResolvedValue({ id: 'existing' });

    await expect(
      sessionService.createSession({
        name: 'X',
        hostUserId: 'u1',
        jiraSnapshot: { baseUrl: 'https://jira.example.com', email: 'jira@example.com', apiTokenEncrypted: 'enc' },
        tickets: [],
      }),
    ).rejects.toThrow('UNABLE_TO_GENERATE_SESSION_CODE');
  });

  it('rejects invalid vote values', async () => {
    await expect(sessionService.vote('s1', 't1', 'u1', '999')).rejects.toThrow('INVALID_VOTE_VALUE');
    expect(prismaMock.sessionVote.upsert).not.toHaveBeenCalled();
  });

  it('saves valid vote and updates last activity', async () => {
    prismaMock.sessionVote.upsert.mockResolvedValueOnce({});
    prismaMock.planningPokerSession.update.mockResolvedValueOnce({});

    await sessionService.vote('s1', 't1', 'u1', '5');

    expect(prismaMock.sessionVote.upsert).toHaveBeenCalled();
    expect(prismaMock.planningPokerSession.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { lastActivityAt: expect.any(Date) },
    });
  });

  it('reveals votes and computes stats', async () => {
    prismaMock.sessionParticipant.findMany.mockResolvedValueOnce([{ userId: 'u1' }, { userId: 'u2' }]);
    prismaMock.sessionVote.findMany.mockResolvedValueOnce([{ value: '3' }, { value: '5' }, { value: 'coffee' }]);
    prismaMock.sessionAudit.create.mockResolvedValueOnce({});
    prismaMock.planningPokerSession.update.mockResolvedValueOnce({});

    const stats = await sessionService.reveal({ id: 's1', activeTicketId: 't1' } as any);

    expect(stats.minimum).toBe(3);
    expect(stats.maximum).toBe(5);
    expect(stats.suggestedStoryPoints).toBe(5);
    expect(prismaMock.sessionAudit.create).toHaveBeenCalled();
  });

  it('reveals votes with only coffee values and returns null numeric stats', async () => {
    prismaMock.sessionParticipant.findMany.mockResolvedValueOnce([{ userId: 'u1' }]);
    prismaMock.sessionVote.findMany.mockResolvedValueOnce([{ value: 'coffee' }]);
    prismaMock.sessionAudit.create.mockResolvedValueOnce({});
    prismaMock.planningPokerSession.update.mockResolvedValueOnce({});

    const stats = await sessionService.reveal({ id: 's1', activeTicketId: 't1' } as any);
    expect(stats.minimum).toBeNull();
    expect(stats.maximum).toBeNull();
    expect(stats.average).toBeNull();
    expect(stats.suggestedStoryPoints).toBeNull();
  });

  it('reveals votes and falls back suggested story points to 21 for large values', async () => {
    prismaMock.sessionParticipant.findMany.mockResolvedValueOnce([{ userId: 'u1' }]);
    prismaMock.sessionVote.findMany.mockResolvedValueOnce([{ value: '100' }]);
    prismaMock.sessionAudit.create.mockResolvedValueOnce({});
    prismaMock.planningPokerSession.update.mockResolvedValueOnce({});

    const stats = await sessionService.reveal({ id: 's1', activeTicketId: 't1' } as any);
    expect(stats.suggestedStoryPoints).toBe(21);
  });

  it('throws when revealing without active ticket', async () => {
    await expect(sessionService.reveal({ id: 's1', activeTicketId: null } as any)).rejects.toThrow('NO_ACTIVE_TICKET');
  });

  it('restarts vote, finishes and skips ticket only with active ticket', async () => {
    await expect(sessionService.restartVote({ id: 's1', activeTicketId: null } as any)).rejects.toThrow('NO_ACTIVE_TICKET');
    await expect(sessionService.finishTicket({ id: 's1', activeTicketId: null } as any, 3)).rejects.toThrow(
      'NO_ACTIVE_TICKET',
    );
    await expect(sessionService.skipTicket({ id: 's1', activeTicketId: null } as any)).rejects.toThrow('NO_ACTIVE_TICKET');

    prismaMock.sessionVote.deleteMany.mockResolvedValueOnce({});
    prismaMock.planningPokerSession.update.mockResolvedValue({});
    prismaMock.sessionTicket.update.mockResolvedValueOnce({});

    await sessionService.restartVote({ id: 's1', activeTicketId: 't1' } as any);
    await sessionService.finishTicket({ id: 's1', activeTicketId: 't1' } as any, 8);
    await sessionService.skipTicket({ id: 's1', activeTicketId: 't1' } as any);

    expect(prismaMock.sessionTicket.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: expect.objectContaining({ isDone: true, finalStoryPoints: 8, doneAt: expect.any(Date) }),
    });
  });

  it('starts closing when everyone leaves and transfers host otherwise', async () => {
    prismaMock.planningPokerSession.findUnique.mockResolvedValueOnce({ hostUserId: 'u1', status: 'ACTIVE' });
    prismaMock.sessionParticipant.updateMany.mockResolvedValue({});
    prismaMock.sessionParticipant.count.mockResolvedValueOnce(0);
    const startClosingSpy = jest.spyOn(sessionService, 'startClosing').mockResolvedValueOnce();

    await sessionService.leaveSession('s1', 'u1');
    expect(startClosingSpy).toHaveBeenCalledWith('s1', 'empty');

    prismaMock.planningPokerSession.findUnique.mockResolvedValueOnce({ hostUserId: 'u1', status: 'ACTIVE' });
    prismaMock.sessionParticipant.count.mockResolvedValueOnce(1);
    prismaMock.sessionParticipant.findFirst.mockResolvedValueOnce({ userId: 'u2' });
    prismaMock.planningPokerSession.update.mockResolvedValueOnce({});

    await sessionService.leaveSession('s1', 'u1');
    expect(prismaMock.planningPokerSession.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { hostUserId: 'u2', lastActivityAt: expect.any(Date) },
    });
  });

  it('schedules auto-close for active stale session and calls onClose', async () => {
    jest.useFakeTimers();
    prismaMock.planningPokerSession.findUnique.mockResolvedValueOnce({
      id: 's1',
      status: 'ACTIVE',
      lastActivityAt: new Date(Date.now() - 1_000),
    });
    const startClosingSpy = jest.spyOn(sessionService, 'startClosing').mockResolvedValueOnce();
    const onClose = jest.fn().mockResolvedValue(undefined);

    sessionService.scheduleAutoClose(
      {
        id: 's1',
        status: 'ACTIVE',
        lastActivityAt: new Date(Date.now() - 1_000),
        closingEndsAt: null,
      } as any,
      onClose,
    );

    await jest.runOnlyPendingTimersAsync();

    expect(startClosingSpy).toHaveBeenCalledWith('s1', 'inactivity');
    expect(onClose).toHaveBeenCalledWith('s1');
  });

  it('checks session management rights for host or admin', () => {
    expect(sessionService.canManageSession({ hostUserId: 'u1' } as any, { id: 'u1', role: 'USER' } as any)).toBe(true);
    expect(sessionService.canManageSession({ hostUserId: 'u1' } as any, { id: 'u2', role: 'ADMIN' } as any)).toBe(true);
    expect(sessionService.canManageSession({ hostUserId: 'u1' } as any, { id: 'u2', role: 'USER' } as any)).toBe(false);
  });

  it('finds sessions by id and code', async () => {
    prismaMock.planningPokerSession.findUnique.mockResolvedValueOnce({ id: 's1' });
    prismaMock.planningPokerSession.findFirst.mockResolvedValueOnce({ id: 's2' });

    await sessionService.findById('s1');
    await sessionService.findByCode('abc123');

    expect(prismaMock.planningPokerSession.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's1' } }),
    );
    expect(prismaMock.planningPokerSession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ code: 'ABC123' }) }),
    );
  });

  it('joins session by upserting participant and touching activity', async () => {
    prismaMock.sessionParticipant.upsert.mockResolvedValueOnce({});
    prismaMock.planningPokerSession.update.mockResolvedValueOnce({});

    await sessionService.joinSession('s1', 'u1');

    expect(prismaMock.sessionParticipant.upsert).toHaveBeenCalled();
    expect(prismaMock.planningPokerSession.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { lastActivityAt: expect.any(Date) },
    });
  });

  it('does not transfer host when next host is missing or session closed', async () => {
    prismaMock.planningPokerSession.findUnique.mockResolvedValueOnce({ hostUserId: 'u1', status: 'CLOSED' });
    prismaMock.sessionParticipant.updateMany.mockResolvedValueOnce({});
    prismaMock.sessionParticipant.count.mockResolvedValueOnce(1);

    await sessionService.leaveSession('s1', 'u1');
    expect(prismaMock.sessionParticipant.findFirst).not.toHaveBeenCalled();

    prismaMock.planningPokerSession.findUnique.mockResolvedValueOnce({ hostUserId: 'u1', status: 'ACTIVE' });
    prismaMock.sessionParticipant.updateMany.mockResolvedValueOnce({});
    prismaMock.sessionParticipant.count.mockResolvedValueOnce(1);
    prismaMock.sessionParticipant.findFirst.mockResolvedValueOnce(null);

    await sessionService.leaveSession('s1', 'u1');
    expect(prismaMock.planningPokerSession.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ hostUserId: expect.anything() }) }),
    );
  });

  it('sets observer without deleting vote when not observer or no active ticket', async () => {
    prismaMock.sessionParticipant.update.mockResolvedValue({});
    prismaMock.planningPokerSession.findUnique.mockResolvedValueOnce({ activeTicketId: null });

    await sessionService.setObserver('s1', 'u1', false);
    await sessionService.setObserver('s1', 'u1', true);

    expect(prismaMock.sessionParticipant.update).toHaveBeenCalledTimes(2);
    expect(prismaMock.sessionVote.deleteMany).not.toHaveBeenCalled();
  });

  it('deletes active vote when participant switches to observer on active ticket', async () => {
    prismaMock.sessionParticipant.update.mockResolvedValueOnce({});
    prismaMock.planningPokerSession.findUnique.mockResolvedValueOnce({ activeTicketId: 't1' });
    prismaMock.sessionVote.deleteMany.mockResolvedValueOnce({});

    await sessionService.setObserver('s1', 'u1', true);

    expect(prismaMock.sessionVote.deleteMany).toHaveBeenCalledWith({
      where: {
        sessionId: 's1',
        ticketId: 't1',
        userId: 'u1',
      },
    });
  });

  it('activates ticket and updates related records', async () => {
    prismaMock.sessionVote.deleteMany.mockResolvedValueOnce({});
    prismaMock.sessionTicket.update.mockResolvedValueOnce({});
    prismaMock.planningPokerSession.update.mockResolvedValueOnce({});

    await sessionService.activateTicket({ id: 's1' } as any, { id: 't1' } as any);

    expect(prismaMock.sessionVote.deleteMany).toHaveBeenCalledWith({
      where: { sessionId: 's1', ticketId: 't1' },
    });
    expect(prismaMock.sessionTicket.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { selectedAt: expect.any(Date) },
    });
    expect(prismaMock.planningPokerSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1' },
      }),
    );
  });

  it('transfers host explicitly', async () => {
    prismaMock.planningPokerSession.update.mockResolvedValueOnce({});
    await sessionService.transferHost('s1', 'u2');
    expect(prismaMock.planningPokerSession.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { hostUserId: 'u2', lastActivityAt: expect.any(Date) },
    });
  });

  it('starts and closes session with audit trail', async () => {
    prismaMock.planningPokerSession.update.mockResolvedValue({});
    prismaMock.sessionAudit.create.mockResolvedValue({});

    await sessionService.startClosing('s1', 'manual');
    await sessionService.closeSession('s1', 'manual');

    expect(prismaMock.sessionAudit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sessionId: 's1' }),
      }),
    );
  });

  it('schedules finalization for closing sessions', async () => {
    jest.useFakeTimers();
    const onClose = jest.fn().mockResolvedValue(undefined);

    sessionService.scheduleAutoClose(
      {
        id: 's1',
        status: 'CLOSING',
        lastActivityAt: new Date(),
        closingEndsAt: new Date(Date.now() + 5),
      } as any,
      onClose,
    );

    await jest.advanceTimersByTimeAsync(10);
    expect(onClose).toHaveBeenCalledWith('s1');
  });

  it('swallows onClose errors in closing and active auto-close flows', async () => {
    jest.useFakeTimers();

    const failingOnClose = jest.fn().mockRejectedValue(new Error('close failed'));
    sessionService.scheduleAutoClose(
      {
        id: 's1',
        status: 'CLOSING',
        lastActivityAt: new Date(),
        closingEndsAt: new Date(Date.now() + 5),
      } as any,
      failingOnClose,
    );
    await jest.advanceTimersByTimeAsync(10);

    prismaMock.planningPokerSession.findUnique.mockResolvedValueOnce({
      id: 's2',
      status: 'ACTIVE',
      lastActivityAt: new Date(Date.now() - 1_000),
    });
    const startClosingSpy = jest.spyOn(sessionService, 'startClosing').mockResolvedValueOnce();
    const failingOnCloseFromActive = jest.fn().mockRejectedValue(new Error('close failed'));

    sessionService.scheduleAutoClose(
      {
        id: 's2',
        status: 'ACTIVE',
        lastActivityAt: new Date(Date.now() - 1_000),
        closingEndsAt: null,
      } as any,
      failingOnCloseFromActive,
    );
    await jest.runOnlyPendingTimersAsync();

    expect(startClosingSpy).toHaveBeenCalledWith('s2', 'inactivity');
    expect(failingOnClose).toHaveBeenCalledWith('s1');
    expect(failingOnCloseFromActive).toHaveBeenCalledWith('s2');
  });

  it('does nothing in auto-close for closed or non-active reloaded session', async () => {
    jest.useFakeTimers();
    const onClose = jest.fn().mockResolvedValue(undefined);

    sessionService.scheduleAutoClose(
      {
        id: 's1',
        status: 'CLOSED',
        lastActivityAt: new Date(),
        closingEndsAt: null,
      } as any,
      onClose,
    );
    expect(onClose).not.toHaveBeenCalled();

    prismaMock.planningPokerSession.findUnique.mockResolvedValueOnce({
      id: 's1',
      status: 'CLOSING',
      lastActivityAt: new Date(),
    });

    sessionService.scheduleAutoClose(
      {
        id: 's1',
        status: 'ACTIVE',
        lastActivityAt: new Date(Date.now() - 1000),
        closingEndsAt: null,
      } as any,
      onClose,
    );

    await jest.runOnlyPendingTimersAsync();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('reschedules auto-close when activity becomes recent', async () => {
    jest.useFakeTimers();
    const recurseSpy = jest.spyOn(sessionService, 'scheduleAutoClose');
    const onClose = jest.fn().mockResolvedValue(undefined);

    prismaMock.planningPokerSession.findUnique.mockResolvedValueOnce({
      id: 's1',
      status: 'ACTIVE',
      lastActivityAt: new Date(),
      closingEndsAt: null,
    });

    sessionService.scheduleAutoClose(
      {
        id: 's1',
        status: 'ACTIVE',
        lastActivityAt: new Date(Date.now() - 1000),
        closingEndsAt: null,
      } as any,
      onClose,
    );

    await jest.runOnlyPendingTimersAsync();
    expect(recurseSpy).toHaveBeenCalledTimes(2);
  });
});
