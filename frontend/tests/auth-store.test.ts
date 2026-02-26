import { createPinia, setActivePinia } from 'pinia';
import { useAuthStore } from '../src/stores/auth';
import { api } from '../src/services/api';

jest.mock('../src/services/api', () => ({
  api: {
    post: jest.fn(),
  },
}));

describe('auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    jest.clearAllMocks();
  });

  it('sets authentication state after refresh', async () => {
    const user = {
      id: 'user-1',
      email: 'test@example.com',
      displayName: 'Test User',
      role: 'USER' as const,
      avatarDataUrl: null,
      hasJiraCredentials: false,
    };

    (api.post as jest.Mock).mockResolvedValueOnce({
      data: {
        accessToken: 'access-token',
        user,
      },
    });

    const store = useAuthStore();
    await store.refresh();

    expect(store.accessToken).toBe('access-token');
    expect(store.user).toEqual(user);
    expect(store.isAuthenticated).toBe(true);
  });

  it('bootstraps and marks store as bootstrapped when refresh fails', async () => {
    (api.post as jest.Mock).mockRejectedValueOnce(new Error('unauthorized'));

    const store = useAuthStore();
    store.accessToken = 'stale-token';
    store.user = {
      id: 'user-stale',
      email: 'stale@example.com',
      displayName: 'Stale User',
      role: 'USER',
      avatarDataUrl: null,
      hasJiraCredentials: false,
    };

    await store.bootstrap();

    expect(store.bootstrapped).toBe(true);
    expect(store.accessToken).toBe('');
    expect(store.user).toBeNull();
  });

  it('sets state after register and login', async () => {
    const registeredUser = {
      id: 'user-10',
      email: 'new@example.com',
      displayName: 'New User',
      role: 'USER' as const,
      avatarDataUrl: null,
      hasJiraCredentials: false,
    };

    const loggedUser = {
      id: 'user-11',
      email: 'login@example.com',
      displayName: 'Login User',
      role: 'ADMIN' as const,
      avatarDataUrl: null,
      hasJiraCredentials: true,
    };

    (api.post as jest.Mock)
      .mockResolvedValueOnce({ data: { accessToken: 'register-token', user: registeredUser } })
      .mockResolvedValueOnce({ data: { accessToken: 'login-token', user: loggedUser } });

    const store = useAuthStore();
    await store.register({ email: registeredUser.email, displayName: registeredUser.displayName, password: 'secret' });
    expect(store.accessToken).toBe('register-token');
    expect(store.user).toEqual(registeredUser);

    await store.login({ email: loggedUser.email, password: 'secret' });
    expect(store.accessToken).toBe('login-token');
    expect(store.user).toEqual(loggedUser);
  });

  it('clears authentication state on logout', async () => {
    (api.post as jest.Mock).mockResolvedValue(undefined);

    const store = useAuthStore();
    store.accessToken = 'existing-token';
    store.user = {
      id: 'user-2',
      email: 'other@example.com',
      displayName: 'Other User',
      role: 'ADMIN',
      avatarDataUrl: null,
      hasJiraCredentials: true,
    };

    await store.logout();

    expect(store.accessToken).toBe('');
    expect(store.user).toBeNull();
    expect(api.post).toHaveBeenCalledWith('/auth/logout');
  });

  it('does not bootstrap twice once already bootstrapped', async () => {
    const store = useAuthStore();
    store.bootstrapped = true;

    await store.bootstrap();

    expect(api.post).not.toHaveBeenCalled();
  });

  it('allows setting user explicitly', () => {
    const store = useAuthStore();
    store.setUser({
      id: 'user-3',
      email: 'set@example.com',
      displayName: 'Set User',
      role: 'USER',
      avatarDataUrl: null,
      hasJiraCredentials: false,
    });

    expect(store.user?.id).toBe('user-3');
    store.setUser(null);
    expect(store.user).toBeNull();
  });
});
