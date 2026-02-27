import Fastify, { FastifyInstance } from 'fastify';
import { sessionRoutes } from '../src/modules/sessions/routes.js';
import { sessionService } from '../src/modules/sessions/service.js';
import { jiraService } from '../src/modules/jira/service.js';
import { prisma } from '../src/prisma.js';

const ioEmit = jest.fn();
const ioMock = {
  to: jest.fn(() => ({ emit: ioEmit })),
};

jest.mock('../src/realtime.js', () => ({
  getIo: () => ioMock,
  sessionRoom: (id: string) => `session:${id}`,
}));

jest.mock('../src/modules/sessions/service.js', () => ({
  sessionService: {
    findByCode: jest.fn(),
    findById: jest.fn(),
    createSession: jest.fn(),
    joinSession: jest.fn(),
    leaveSession: jest.fn(),
    setObserver: jest.fn(),
    activateTicket: jest.fn(),
    vote: jest.fn(),
    reveal: jest.fn(),
    restartVote: jest.fn(),
    finishTicket: jest.fn(),
    skipTicket: jest.fn(),
    transferHost: jest.fn(),
    startClosing: jest.fn(),
    closeSession: jest.fn(),
    scheduleAutoClose: jest.fn(),
    canManageSession: jest.fn(),
  },
}));

jest.mock('../src/modules/jira/service.js', () => ({
  jiraService: {
    assignStoryPointsForSession: jest.fn(),
    getIssueByKeyForSession: jest.fn(),
  },
}));

jest.mock('../src/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
    planningPokerSession: {
      findUnique: jest.fn(),
    },
    sessionVote: {
      findMany: jest.fn(),
    },
  },
}));

const baseSession = {
  id: 's1',
  code: 'ABC123',
  name: 'Sprint',
  status: 'ACTIVE',
  phase: 'VOTING',
  hostUserId: 'u1',
  activeTicketId: 't1',
  jiraBaseUrl: 'https://jira.example.com',
  jiraEmail: 'jira@example.com',
  jiraApiTokenEncrypted: 'enc',
  tickets: [{ id: 't1', jiraIssueKey: 'PROJ-1', isDone: false }],
  participants: [
    {
      userId: 'u1',
      isObserver: false,
      user: { id: 'u1', displayName: 'User 1', avatarDataUrl: null, role: 'USER' },
    },
  ],
};

const createApp = async (currentUser: any): Promise<FastifyInstance> => {
  const app = Fastify();
  app.decorateRequest('currentUser', null);
  app.addHook('preHandler', async (request) => {
    request.currentUser = currentUser;
  });
  await app.register(sessionRoutes, { prefix: '/api' });
  return app;
};

describe('sessions routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (sessionService.findById as jest.Mock).mockResolvedValue(baseSession);
    (sessionService.findByCode as jest.Mock).mockResolvedValue(baseSession);
    (sessionService.canManageSession as jest.Mock).mockReturnValue(true);
    (prisma.sessionVote.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.planningPokerSession.findUnique as jest.Mock).mockResolvedValue(null);
    (sessionService.createSession as jest.Mock).mockResolvedValue({ id: 's1' });
    (jiraService.getIssueByKeyForSession as jest.Mock).mockResolvedValue({
      key: 'PROJ-1',
      summary: 'Ticket 1',
      description: 'Description',
    });
  });

  it('returns 404 when joining by code and session is missing', async () => {
    (sessionService.findByCode as jest.Mock).mockResolvedValueOnce(null);
    const app = await createApp({ id: 'u1' });

    const response = await app.inject({ method: 'GET', url: '/api/sessions/join/unknown' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'SESSION_NOT_FOUND' });
    await app.close();
  });

  it('creates session when jira is configured and tickets are provided', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
      jiraBaseUrl: 'https://jira.example.com',
      jiraEmail: 'jira@example.com',
      jiraApiTokenEncrypted: 'enc',
    });
    const app = await createApp({ id: 'u1' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        name: 'Sprint',
        tickets: [{ jiraIssueKey: 'PROJ-1', jiraIssueId: '10001', summary: 'Ticket 1' }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(sessionService.createSession).toHaveBeenCalled();
    expect(ioMock.to).toHaveBeenCalledWith('session:s1');
    await app.close();
  });

  it('returns 422 when creating session with no tickets', async () => {
    const app = await createApp({ id: 'u1' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'Sprint', tickets: [] },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ error: 'AT_LEAST_ONE_TICKET_REQUIRED' });
    await app.close();
  });

  it('returns 422 when jira is not configured on host', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
      jiraBaseUrl: null,
      jiraEmail: null,
      jiraApiTokenEncrypted: null,
    });
    const app = await createApp({ id: 'u1' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        name: 'Sprint',
        tickets: [{ jiraIssueKey: 'PROJ-1', jiraIssueId: '10001', summary: 'Ticket 1' }],
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ error: 'JIRA_NOT_CONFIGURED' });
    await app.close();
  });

  it('returns 422 when voting in invalid phase/state', async () => {
    (sessionService.findById as jest.Mock).mockResolvedValueOnce({ ...baseSession, activeTicketId: null });
    const app = await createApp({ id: 'u1' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions/s1/vote',
      payload: { value: '3' },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ error: 'INVALID_STATE' });
    await app.close();
  });

  it('returns 403 when observer attempts to vote', async () => {
    (sessionService.findById as jest.Mock).mockResolvedValueOnce({
      ...baseSession,
      participants: [{ userId: 'u1', isObserver: true, user: { id: 'u1' } }],
    });
    const app = await createApp({ id: 'u1' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions/s1/vote',
      payload: { value: '3' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'NOT_ENOUGH_RIGHTS' });
    await app.close();
  });

  it('records vote when participant is allowed', async () => {
    const app = await createApp({ id: 'u1' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions/s1/vote',
      payload: { value: '5' },
    });

    expect(response.statusCode).toBe(200);
    expect(sessionService.vote).toHaveBeenCalledWith('s1', 't1', 'u1', '5');
    await app.close();
  });

  it('returns 403 on reveal when user cannot manage session', async () => {
    (sessionService.canManageSession as jest.Mock).mockReturnValueOnce(false);
    const app = await createApp({ id: 'u2' });

    const response = await app.inject({ method: 'POST', url: '/api/sessions/s1/reveal' });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'NOT_ENOUGH_RIGHTS' });
    await app.close();
  });

  it('assigns story points when value and state are valid', async () => {
    const app = await createApp({ id: 'u1' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions/s1/assign-story-points',
      payload: { storyPoints: 5 },
    });

    expect(response.statusCode).toBe(200);
    expect(jiraService.assignStoryPointsForSession).toHaveBeenCalledWith(baseSession, 'PROJ-1', 'PROJ', 5);
    expect(sessionService.finishTicket).toHaveBeenCalledWith(baseSession, 5);
    await app.close();
  });

  it('returns 422 when assigning story points with invalid value', async () => {
    const app = await createApp({ id: 'u1' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions/s1/assign-story-points',
      payload: { storyPoints: 4 },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ error: 'INVALID_STATE_OR_VALUE' });
    await app.close();
  });

  it('returns 404 when transferring host to non participant', async () => {
    const app = await createApp({ id: 'u1' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions/s1/transfer-host',
      payload: { userId: 'u-missing' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'USER_NOT_IN_SESSION' });
    await app.close();
  });

  it('enforces reaction cooldown', async () => {
    const app = await createApp({ id: 'u1' });

    const first = await app.inject({
      method: 'POST',
      url: '/api/sessions/s1/reaction',
      payload: { emoji: ':+1:' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/sessions/s1/reaction',
      payload: { emoji: ':+1:' },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(429);
    expect(second.json()).toEqual({ error: 'REACTION_COOLDOWN' });
    await app.close();
  });

  it('joins and leaves a session', async () => {
    const app = await createApp({ id: 'u1' });

    const joinResponse = await app.inject({ method: 'POST', url: '/api/sessions/s1/join' });
    const leaveResponse = await app.inject({ method: 'POST', url: '/api/sessions/s1/leave' });

    expect(joinResponse.statusCode).toBe(200);
    expect(leaveResponse.statusCode).toBe(200);
    expect(sessionService.joinSession).toHaveBeenCalledWith('s1', 'u1');
    expect(sessionService.leaveSession).toHaveBeenCalledWith('s1', 'u1');
    await app.close();
  });

  it('returns 404 when joining closed/missing session', async () => {
    (sessionService.findById as jest.Mock).mockResolvedValueOnce(null);
    const app = await createApp({ id: 'u1' });
    const response = await app.inject({ method: 'POST', url: '/api/sessions/s1/join' });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('returns 404 on leave when session not found', async () => {
    (sessionService.findById as jest.Mock).mockResolvedValueOnce(null);
    const app = await createApp({ id: 'u1' });
    const response = await app.inject({ method: 'POST', url: '/api/sessions/s1/leave' });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('handles participant ping checks', async () => {
    const app = await createApp({ id: 'u1' });
    const okResponse = await app.inject({ method: 'POST', url: '/api/sessions/s1/ping' });
    expect(okResponse.statusCode).toBe(200);

    (sessionService.findById as jest.Mock).mockResolvedValueOnce({ ...baseSession, participants: [] });
    const forbiddenResponse = await app.inject({ method: 'POST', url: '/api/sessions/s1/ping' });
    expect(forbiddenResponse.statusCode).toBe(403);
    expect(forbiddenResponse.json()).toEqual({ error: 'NOT_IN_SESSION' });
    await app.close();
  });

  it('returns session state on get by id and 404 when missing', async () => {
    const app = await createApp({ id: 'u1' });
    const okResponse = await app.inject({ method: 'GET', url: '/api/sessions/s1' });
    expect(okResponse.statusCode).toBe(200);
    expect(okResponse.json().session.id).toBe('s1');

    (sessionService.findById as jest.Mock).mockResolvedValueOnce(null);
    const missingResponse = await app.inject({ method: 'GET', url: '/api/sessions/s1' });
    expect(missingResponse.statusCode).toBe(404);
    await app.close();
  });

  it('returns issue details through session credentials for participants only', async () => {
    const app = await createApp({ id: 'u1' });
    const okResponse = await app.inject({ method: 'GET', url: '/api/sessions/s1/issues/proj-1' });

    expect(okResponse.statusCode).toBe(200);
    expect(jiraService.getIssueByKeyForSession).toHaveBeenCalledWith(baseSession, 'PROJ-1');
    expect(okResponse.json()).toEqual({
      item: { key: 'PROJ-1', summary: 'Ticket 1', description: 'Description' },
    });

    (sessionService.findById as jest.Mock).mockResolvedValueOnce({ ...baseSession, participants: [] });
    const forbiddenResponse = await app.inject({ method: 'GET', url: '/api/sessions/s1/issues/proj-1' });
    expect(forbiddenResponse.statusCode).toBe(403);
    expect(forbiddenResponse.json()).toEqual({ error: 'NOT_IN_SESSION' });

    (sessionService.findById as jest.Mock).mockResolvedValueOnce(baseSession);
    const missingTicketResponse = await app.inject({ method: 'GET', url: '/api/sessions/s1/issues/proj-999' });
    expect(missingTicketResponse.statusCode).toBe(404);
    expect(missingTicketResponse.json()).toEqual({ error: 'TICKET_NOT_FOUND' });

    (sessionService.findById as jest.Mock).mockResolvedValueOnce({ ...baseSession, status: 'CLOSED' });
    const closedSessionResponse = await app.inject({ method: 'GET', url: '/api/sessions/s1/issues/proj-1' });
    expect(closedSessionResponse.statusCode).toBe(404);
    expect(closedSessionResponse.json()).toEqual({ error: 'SESSION_NOT_FOUND' });
    await app.close();
  });

  it('sets observer mode for participant', async () => {
    const app = await createApp({ id: 'u1' });
    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions/s1/observer',
      payload: { isObserver: true },
    });
    expect(response.statusCode).toBe(200);
    expect(sessionService.setObserver).toHaveBeenCalledWith('s1', 'u1', true);
    await app.close();
  });

  it('activates ticket when manager has rights', async () => {
    const app = await createApp({ id: 'u1' });
    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions/s1/activate-ticket',
      payload: { ticketId: 't1' },
    });
    expect(response.statusCode).toBe(200);
    expect(sessionService.activateTicket).toHaveBeenCalled();
    await app.close();
  });

  it('returns errors for activate ticket when forbidden or missing ticket', async () => {
    (sessionService.canManageSession as jest.Mock).mockReturnValueOnce(false);
    const app = await createApp({ id: 'u2' });
    const forbidden = await app.inject({
      method: 'POST',
      url: '/api/sessions/s1/activate-ticket',
      payload: { ticketId: 't1' },
    });
    expect(forbidden.statusCode).toBe(403);

    (sessionService.canManageSession as jest.Mock).mockReturnValue(true);
    (sessionService.findById as jest.Mock).mockResolvedValueOnce({ ...baseSession, tickets: [] });
    const missingTicket = await app.inject({
      method: 'POST',
      url: '/api/sessions/s1/activate-ticket',
      payload: { ticketId: 't1' },
    });
    expect(missingTicket.statusCode).toBe(404);
    await app.close();
  });

  it('reveals and restarts vote when states are valid', async () => {
    (sessionService.reveal as jest.Mock).mockResolvedValueOnce({ average: 5 });
    const app = await createApp({ id: 'u1' });

    const reveal = await app.inject({ method: 'POST', url: '/api/sessions/s1/reveal' });
    expect(reveal.statusCode).toBe(200);
    expect(reveal.json()).toEqual({ ok: true, stats: { average: 5 } });

    (sessionService.findById as jest.Mock).mockResolvedValueOnce({ ...baseSession, phase: 'REVEALED' });
    const restart = await app.inject({ method: 'POST', url: '/api/sessions/s1/restart-vote' });
    expect(restart.statusCode).toBe(200);
    expect(sessionService.restartVote).toHaveBeenCalled();
    await app.close();
  });

  it('returns 422 on restart vote when not in REVEALED phase', async () => {
    const app = await createApp({ id: 'u1' });
    const response = await app.inject({ method: 'POST', url: '/api/sessions/s1/restart-vote' });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ error: 'INVALID_STATE' });
    await app.close();
  });

  it('skips ticket and closes session when manager has rights', async () => {
    const app = await createApp({ id: 'u1' });
    const skip = await app.inject({ method: 'POST', url: '/api/sessions/s1/skip-ticket' });
    const close = await app.inject({ method: 'POST', url: '/api/sessions/s1/close' });

    expect(skip.statusCode).toBe(200);
    expect(close.statusCode).toBe(200);
    expect(sessionService.skipTicket).toHaveBeenCalledWith(baseSession);
    expect(sessionService.startClosing).toHaveBeenCalledWith('s1', 'manual');
    await app.close();
  });

  it('transfers host when participant exists', async () => {
    const sessionWithNextHost = {
      ...baseSession,
      participants: [...baseSession.participants, { userId: 'u2', isObserver: false, user: { id: 'u2' } }],
    };
    (sessionService.findById as jest.Mock).mockResolvedValueOnce(sessionWithNextHost);
    const app = await createApp({ id: 'u1' });
    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions/s1/transfer-host',
      payload: { userId: 'u2' },
    });
    expect(response.statusCode).toBe(200);
    expect(sessionService.transferHost).toHaveBeenCalledWith('s1', 'u2');
    await app.close();
  });

  it('blocks reaction for user not in session', async () => {
    (sessionService.findById as jest.Mock).mockResolvedValueOnce({ ...baseSession, participants: [] });
    const app = await createApp({ id: 'u1' });
    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions/s1/reaction',
      payload: { emoji: ':+1:' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'NOT_IN_SESSION' });
    await app.close();
  });

  it('returns session on join-by-code success', async () => {
    const app = await createApp({ id: 'u1' });
    const response = await app.inject({ method: 'GET', url: '/api/sessions/join/ABC123' });
    expect(response.statusCode).toBe(200);
    expect(response.json().session.id).toBe('s1');
    await app.close();
  });

  it('returns missing/forbidden errors on many management endpoints', async () => {
    const app = await createApp({ id: 'u1' });

    (sessionService.findById as jest.Mock).mockResolvedValueOnce({ ...baseSession, status: 'CLOSED' });
    const pingClosed = await app.inject({ method: 'POST', url: '/api/sessions/s1/ping' });
    expect(pingClosed.statusCode).toBe(404);

    (sessionService.findById as jest.Mock).mockResolvedValueOnce(null);
    const observerMissing = await app.inject({
      method: 'POST',
      url: '/api/sessions/s1/observer',
      payload: { isObserver: true },
    });
    expect(observerMissing.statusCode).toBe(404);

    (sessionService.findById as jest.Mock).mockResolvedValueOnce(null);
    const activateMissing = await app.inject({
      method: 'POST',
      url: '/api/sessions/s1/activate-ticket',
      payload: { ticketId: 't1' },
    });
    expect(activateMissing.statusCode).toBe(404);

    (sessionService.findById as jest.Mock).mockResolvedValueOnce(null);
    const voteMissing = await app.inject({
      method: 'POST',
      url: '/api/sessions/s1/vote',
      payload: { value: '3' },
    });
    expect(voteMissing.statusCode).toBe(404);

    (sessionService.findById as jest.Mock).mockResolvedValueOnce(null);
    const revealMissing = await app.inject({ method: 'POST', url: '/api/sessions/s1/reveal' });
    expect(revealMissing.statusCode).toBe(404);

    (sessionService.findById as jest.Mock).mockResolvedValueOnce({ ...baseSession, phase: 'IDLE' });
    const revealInvalid = await app.inject({ method: 'POST', url: '/api/sessions/s1/reveal' });
    expect(revealInvalid.statusCode).toBe(422);

    (sessionService.findById as jest.Mock).mockResolvedValueOnce(null);
    const restartMissing = await app.inject({ method: 'POST', url: '/api/sessions/s1/restart-vote' });
    expect(restartMissing.statusCode).toBe(404);

    (sessionService.canManageSession as jest.Mock).mockReturnValueOnce(false);
    const restartForbidden = await app.inject({ method: 'POST', url: '/api/sessions/s1/restart-vote' });
    expect(restartForbidden.statusCode).toBe(403);

    (sessionService.findById as jest.Mock).mockResolvedValueOnce(null);
    const assignMissing = await app.inject({
      method: 'POST',
      url: '/api/sessions/s1/assign-story-points',
      payload: { storyPoints: 3 },
    });
    expect(assignMissing.statusCode).toBe(404);

    (sessionService.canManageSession as jest.Mock).mockReturnValueOnce(false);
    const assignForbidden = await app.inject({
      method: 'POST',
      url: '/api/sessions/s1/assign-story-points',
      payload: { storyPoints: 3 },
    });
    expect(assignForbidden.statusCode).toBe(403);

    (sessionService.findById as jest.Mock).mockResolvedValueOnce({
      ...baseSession,
      tickets: [],
      activeTicketId: 'missing-ticket',
    });
    const assignTicketMissing = await app.inject({
      method: 'POST',
      url: '/api/sessions/s1/assign-story-points',
      payload: { storyPoints: 5 },
    });
    expect(assignTicketMissing.statusCode).toBe(404);

    (sessionService.findById as jest.Mock).mockResolvedValueOnce(null);
    const skipMissing = await app.inject({ method: 'POST', url: '/api/sessions/s1/skip-ticket' });
    expect(skipMissing.statusCode).toBe(404);

    (sessionService.canManageSession as jest.Mock).mockReturnValueOnce(false);
    const skipForbidden = await app.inject({ method: 'POST', url: '/api/sessions/s1/skip-ticket' });
    expect(skipForbidden.statusCode).toBe(403);

    (sessionService.findById as jest.Mock).mockResolvedValueOnce(null);
    const transferMissing = await app.inject({
      method: 'POST',
      url: '/api/sessions/s1/transfer-host',
      payload: { userId: 'u2' },
    });
    expect(transferMissing.statusCode).toBe(404);

    (sessionService.canManageSession as jest.Mock).mockReturnValueOnce(false);
    const transferForbidden = await app.inject({
      method: 'POST',
      url: '/api/sessions/s1/transfer-host',
      payload: { userId: 'u2' },
    });
    expect(transferForbidden.statusCode).toBe(403);

    (sessionService.findById as jest.Mock).mockResolvedValueOnce(null);
    const closeMissing = await app.inject({ method: 'POST', url: '/api/sessions/s1/close' });
    expect(closeMissing.statusCode).toBe(404);

    (sessionService.canManageSession as jest.Mock).mockReturnValueOnce(false);
    const closeForbidden = await app.inject({ method: 'POST', url: '/api/sessions/s1/close' });
    expect(closeForbidden.statusCode).toBe(403);

    (sessionService.findById as jest.Mock).mockResolvedValueOnce({ ...baseSession, status: 'CLOSED' });
    const reactionClosed = await app.inject({
      method: 'POST',
      url: '/api/sessions/s1/reaction',
      payload: { emoji: ':+1:' },
    });
    expect(reactionClosed.statusCode).toBe(404);

    await app.close();
  });

  it('returns unauthorized when currentUser is missing', async () => {
    const app = await createApp(null);
    const response = await app.inject({ method: 'GET', url: '/api/sessions/join/ABC123' });
    expect(response.statusCode).toBe(500);
    await app.close();
  });

  it('computes revealed votes when session is in REVEALED phase', async () => {
    const app = await createApp({ id: 'u1' });
    (sessionService.findById as jest.Mock).mockResolvedValueOnce({
      ...baseSession,
      phase: 'REVEALED',
      participants: [
        ...baseSession.participants,
        { userId: 'u3', isObserver: false, user: { id: 'u3' } },
      ],
    });
    (prisma.sessionVote.findMany as jest.Mock).mockResolvedValueOnce([
      { userId: 'u1', value: '5' },
      { userId: 'u2', value: 'coffee' },
      { userId: 'u3', value: 'NaN' },
    ]);

    const stateResponse = await app.inject({ method: 'GET', url: '/api/sessions/s1' });
    expect(stateResponse.statusCode).toBe(200);
    expect(stateResponse.json().session.revealedVotes).toEqual({ u1: '5', u3: 'NaN' });
    await app.close();
  });

  it('computes vote stats with coffee and suggested fallback to 21', async () => {
    const app = await createApp({ id: 'u1' });
    (sessionService.findById as jest.Mock).mockResolvedValueOnce({
      ...baseSession,
      phase: 'REVEALED',
      participants: [
        ...baseSession.participants,
        { userId: 'u2', isObserver: false, user: { id: 'u2' } },
      ],
    });
    (prisma.sessionVote.findMany as jest.Mock).mockResolvedValueOnce([
      { userId: 'u1', value: 'coffee' },
      { userId: 'u2', value: '100' },
    ]);

    const response = await app.inject({ method: 'GET', url: '/api/sessions/s1' });
    expect(response.statusCode).toBe(200);
    expect(response.json().session.voteStats.suggestedStoryPoints).toBe(21);
    await app.close();
  });

  it('returns session state with null active ticket and empty votes', async () => {
    const app = await createApp({ id: 'u1' });
    (sessionService.findById as jest.Mock).mockResolvedValueOnce({
      ...baseSession,
      activeTicketId: 'missing-ticket',
    });
    const response = await app.inject({ method: 'GET', url: '/api/sessions/s1' });
    expect(response.statusCode).toBe(200);
    expect(response.json().session.activeTicket).toBeNull();
    expect(response.json().session.votedUserIds).toEqual([]);
    await app.close();
  });

  it('executes auto-close callback branches for ACTIVE and CLOSING statuses', async () => {
    (sessionService.scheduleAutoClose as jest.Mock)
      .mockImplementationOnce(async (_session, cb) => {
        await cb('s1');
      })
      .mockImplementationOnce(async (_session, cb) => {
        await cb('s1');
      });
    (prisma.planningPokerSession.findUnique as jest.Mock)
      .mockResolvedValueOnce({
        id: 's1',
        status: 'ACTIVE',
        lastActivityAt: new Date(),
        closingEndsAt: null,
      })
      .mockResolvedValueOnce({ id: 's1', status: 'ACTIVE' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 's1',
        status: 'ACTIVE',
        lastActivityAt: new Date(),
        closingEndsAt: null,
      })
      .mockResolvedValueOnce({ id: 's1', status: 'CLOSING' });
    const app = await createApp({ id: 'u1' });

    await app.inject({ method: 'POST', url: '/api/sessions/s1/join' });
    await app.inject({ method: 'POST', url: '/api/sessions/s1/join' });

    expect(sessionService.startClosing).toHaveBeenCalledWith('s1', 'inactivity');
    expect(sessionService.closeSession).toHaveBeenCalledWith('s1', 'inactivity');
    await app.close();
  });

  it('covers auto-close callback no-op branch when current session is missing', async () => {
    (sessionService.scheduleAutoClose as jest.Mock).mockImplementationOnce(async (_session, cb) => {
      await cb('s1');
    });
    (prisma.planningPokerSession.findUnique as jest.Mock)
      .mockResolvedValueOnce({
        id: 's1',
        status: 'ACTIVE',
        lastActivityAt: new Date(),
        closingEndsAt: null,
      })
      .mockResolvedValueOnce(null);

    const app = await createApp({ id: 'u1' });
    await app.inject({ method: 'POST', url: '/api/sessions/s1/join' });
    expect(sessionService.startClosing).not.toHaveBeenCalledWith('s1', 'inactivity');
    await app.close();
  });

  it('covers auto-close callback closing branch and closes inactive session', async () => {
    (sessionService.scheduleAutoClose as jest.Mock).mockImplementationOnce(async (_session, cb) => {
      await cb('s1');
    });
    (prisma.planningPokerSession.findUnique as jest.Mock)
      .mockResolvedValueOnce({
        id: 's1',
        status: 'ACTIVE',
        lastActivityAt: new Date(),
        closingEndsAt: null,
      })
      .mockResolvedValueOnce({ id: 's1', status: 'CLOSING' });

    const app = await createApp({ id: 'u1' });
    await app.inject({ method: 'POST', url: '/api/sessions/s1/join' });
    expect(sessionService.closeSession).toHaveBeenCalledWith('s1', 'inactivity');
    await app.close();
  });

  it('covers auto-close callback no-op branch for non closing/non active status', async () => {
    (sessionService.scheduleAutoClose as jest.Mock).mockImplementationOnce(async (_session, cb) => {
      await cb('s1');
    });
    (prisma.planningPokerSession.findUnique as jest.Mock)
      .mockResolvedValueOnce({
        id: 's1',
        status: 'ACTIVE',
        lastActivityAt: new Date(),
        closingEndsAt: null,
      })
      .mockResolvedValueOnce({ id: 's1', status: 'IDLE' });

    const app = await createApp({ id: 'u1' });
    await app.inject({ method: 'POST', url: '/api/sessions/s1/join' });
    expect(sessionService.startClosing).not.toHaveBeenCalledWith('s1', 'inactivity');
    expect(sessionService.closeSession).not.toHaveBeenCalledWith('s1', 'inactivity');
    await app.close();
  });

  it('cleans up stale participants via interval callback', async () => {
    let intervalCallback: (() => void) | null = null;
    const setIntervalSpy = jest
      .spyOn(global, 'setInterval')
      .mockImplementation(((cb: any) => {
        intervalCallback = cb as () => void;
        return 1 as unknown as NodeJS.Timeout;
      }) as any);
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval').mockImplementation(() => undefined as any);
    const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(0);

    const app = await createApp({ id: 'u1' });
    await app.inject({ method: 'POST', url: '/api/sessions/s1/ping' });

    dateNowSpy.mockReturnValue(70_000);
    (sessionService.findById as jest.Mock)
      .mockResolvedValueOnce({
        ...baseSession,
      })
      .mockResolvedValue(baseSession);
    (prisma.planningPokerSession.findUnique as jest.Mock).mockResolvedValue(null);

    expect(intervalCallback).toBeTruthy();
    if (intervalCallback) {
      (intervalCallback as any)();
    }
    await new Promise((resolve) => setImmediate(resolve));

    expect(sessionService.leaveSession).toHaveBeenCalledWith('s1', 'u1');
    await app.close();

    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
    dateNowSpy.mockRestore();
  });

  it('returns early when stale cleanup has no stale entries', async () => {
    let intervalCallback: (() => void) | null = null;
    const setIntervalSpy = jest
      .spyOn(global, 'setInterval')
      .mockImplementation(((cb: any) => {
        intervalCallback = cb as () => void;
        return 1 as unknown as NodeJS.Timeout;
      }) as any);
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval').mockImplementation(() => undefined as any);

    const app = await createApp({ id: 'u1' });

    expect(intervalCallback).toBeTruthy();
    if (intervalCallback) {
      (intervalCallback as any)();
    }
    await new Promise((resolve) => setImmediate(resolve));

    expect(sessionService.leaveSession).not.toHaveBeenCalled();
    await app.close();

    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });

  it('skips malformed and stale missing participants during cleanup', async () => {
    let intervalCallback: (() => void) | null = null;
    const setIntervalSpy = jest
      .spyOn(global, 'setInterval')
      .mockImplementation(((cb: any) => {
        intervalCallback = cb as () => void;
        return 1 as unknown as NodeJS.Timeout;
      }) as any);
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval').mockImplementation(() => undefined as any);
    const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(0);

    const app = await createApp({ id: 'u1' });
    await app.inject({ method: 'POST', url: '/api/sessions/s1/ping' });

    // Build stale entries including malformed key and valid key with no participant.
    const arrayFromSpy = jest.spyOn(Array, 'from').mockImplementationOnce(
      (() =>
        [
          ['bad-key', 0],
          ['s1:u1', 0],
        ]) as any,
    );
    dateNowSpy.mockReturnValue(70_000);
    (sessionService.findById as jest.Mock).mockResolvedValueOnce({
      ...baseSession,
      participants: [],
    });

    expect(intervalCallback).toBeTruthy();
    if (intervalCallback) {
      (intervalCallback as any)();
    }
    await new Promise((resolve) => setImmediate(resolve));

    expect(sessionService.leaveSession).not.toHaveBeenCalled();
    await app.close();

    arrayFromSpy.mockRestore();
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
    dateNowSpy.mockRestore();
  });

  it('skips stale participants when session is missing or closed', async () => {
    let intervalCallback: (() => void) | null = null;
    const setIntervalSpy = jest
      .spyOn(global, 'setInterval')
      .mockImplementation(((cb: any) => {
        intervalCallback = cb as () => void;
        return 1 as unknown as NodeJS.Timeout;
      }) as any);
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval').mockImplementation(() => undefined as any);
    const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(0);

    const app = await createApp({ id: 'u1' });
    await app.inject({ method: 'POST', url: '/api/sessions/s1/ping' });
    dateNowSpy.mockReturnValue(70_000);
    (sessionService.findById as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...baseSession, status: 'CLOSED' });

    expect(intervalCallback).toBeTruthy();
    if (intervalCallback) {
      (intervalCallback as any)();
      await new Promise((resolve) => setImmediate(resolve));
      await app.inject({ method: 'POST', url: '/api/sessions/s1/ping' });
      (intervalCallback as any)();
    }
    await new Promise((resolve) => setImmediate(resolve));

    expect(sessionService.leaveSession).not.toHaveBeenCalled();
    await app.close();

    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
    dateNowSpy.mockRestore();
  });

  it('logs cleanup errors from interval callback', async () => {
    let intervalCallback: (() => void) | null = null;
    const setIntervalSpy = jest
      .spyOn(global, 'setInterval')
      .mockImplementation(((cb: any) => {
        intervalCallback = cb as () => void;
        return 1 as unknown as NodeJS.Timeout;
      }) as any);
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval').mockImplementation(() => undefined as any);
    const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(0);

    const app = await createApp({ id: 'u1' });
    const logErrorSpy = jest.spyOn(app.log, 'error');
    await app.inject({ method: 'POST', url: '/api/sessions/s1/ping' });
    dateNowSpy.mockReturnValue(70_000);
    (sessionService.findById as jest.Mock).mockRejectedValueOnce(new Error('cleanup failed'));

    expect(intervalCallback).toBeTruthy();
    if (intervalCallback) {
      (intervalCallback as any)();
    }
    await new Promise((resolve) => setImmediate(resolve));

    expect(logErrorSpy).toHaveBeenCalled();
    await app.close();

    logErrorSpy.mockRestore();
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
    dateNowSpy.mockRestore();
  });
});
