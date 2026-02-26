import { createPinia, setActivePinia } from 'pinia';
import { useSessionStore } from '../src/stores/session';
import { api } from '../src/services/api';
import { socket } from '../src/services/socket';

jest.mock('../src/services/api', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

jest.mock('../src/services/socket', () => ({
  socket: {
    emit: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
  },
}));

const buildSession = () => ({
  id: 'session-1',
  name: 'Sprint 1',
  code: 'ABC123',
  phase: 'IDLE' as const,
  status: 'ACTIVE' as const,
  hostUserId: 'host-1',
  activeTicketId: null,
  activeTicket: null,
  tickets: [],
  participants: [],
  votedUserIds: [],
  revealedVotes: null,
  voteStats: null,
  closingEndsAt: null,
  allowedVotes: ['1', '2', 'coffee'],
  numericVotes: [1, 2],
});

describe('session store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    jest.clearAllMocks();
  });

  it('binds realtime handlers and updates session from socket event', () => {
    const store = useSessionStore();
    store.bindRealtime('session-1');

    expect(socket.emit).toHaveBeenCalledWith('session:join-room', { sessionId: 'session-1' });
    expect(socket.off).toHaveBeenCalledWith('session:update');
    expect(socket.on).toHaveBeenCalledWith('session:update', expect.any(Function));

    const handler = (socket.on as jest.Mock).mock.calls[0][1] as (payload: ReturnType<typeof buildSession>) => void;
    const payload = buildSession();
    handler(payload);

    expect(store.session).toEqual(payload);
  });

  it('unbinds realtime handlers', () => {
    const store = useSessionStore();
    store.unbindRealtime('session-1');

    expect(socket.emit).toHaveBeenCalledWith('session:leave-room', { sessionId: 'session-1' });
    expect(socket.off).toHaveBeenCalledWith('session:update');
  });

  it('fetches and stores session state', async () => {
    const store = useSessionStore();
    const session = buildSession();
    (api.get as jest.Mock).mockResolvedValueOnce({ data: { session } });

    await store.fetch('session-1');

    expect(api.get).toHaveBeenCalledWith('/sessions/session-1');
    expect(store.session).toEqual(session);
  });

  it('joins then refreshes session state', async () => {
    const store = useSessionStore();
    const fetchSpy = jest.spyOn(store, 'fetch').mockResolvedValueOnce();
    (api.post as jest.Mock).mockResolvedValueOnce({});

    await store.join('session-1');

    expect(api.post).toHaveBeenCalledWith('/sessions/session-1/join');
    expect(fetchSpy).toHaveBeenCalledWith('session-1');
  });

  it('votes only when a session is loaded', async () => {
    const store = useSessionStore();
    (api.post as jest.Mock).mockResolvedValue({});

    await store.vote('3');
    expect(api.post).not.toHaveBeenCalled();

    store.session = buildSession();
    await store.vote('3');
    expect(api.post).toHaveBeenCalledWith('/sessions/session-1/vote', { value: '3' });
  });

  it('leaves a session', async () => {
    const store = useSessionStore();
    (api.post as jest.Mock).mockResolvedValueOnce({});

    await store.leave('session-1');

    expect(api.post).toHaveBeenCalledWith('/sessions/session-1/leave');
  });
});
