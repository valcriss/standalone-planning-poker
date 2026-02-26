export {};

let beforeEachGuard: ((to: any) => Promise<any>) | null = null;
let capturedRouterConfig: any = null;

jest.mock('vue-router', () => ({
  createWebHistory: jest.fn(() => 'history'),
  createRouter: jest.fn((config: any) => {
    capturedRouterConfig = config;
    return {
      beforeEach: (cb: (to: any) => Promise<any>) => {
        beforeEachGuard = cb;
      },
    };
  }),
}));

const authStore: any = {
  bootstrapped: false,
  bootstrap: jest.fn(),
  isAuthenticated: false,
  user: null,
};

jest.mock('../src/stores/auth', () => ({
  useAuthStore: () => authStore,
}));

jest.mock('../src/views/LoginView.vue', () => ({}));
jest.mock('../src/views/HomeView.vue', () => ({}));
jest.mock('../src/views/SessionView.vue', () => ({}));
jest.mock('../src/views/AdminView.vue', () => ({}));

describe('router guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authStore.bootstrapped = false;
    authStore.isAuthenticated = false;
    authStore.user = null;
    beforeEachGuard = null;
    capturedRouterConfig = null;
    jest.isolateModules(() => {
      require('../src/router/index');
    });
  });

  it('defines join redirect route mapper', () => {
    const joinRoute = capturedRouterConfig.routes.find((route: any) => route.path === '/join/:code');

    expect(joinRoute.redirect({ params: { code: 'ABC123' } })).toBe('/session/ABC123');
    expect(joinRoute.redirect({ params: {} })).toBe('/session/');
  });

  it('bootstraps when needed and redirects unauthenticated users', async () => {
    const guard = beforeEachGuard as (to: any) => Promise<any>;
    authStore.bootstrap.mockResolvedValueOnce(undefined);

    const result = await guard({ path: '/session/abc', fullPath: '/session/abc', query: {} });
    expect(authStore.bootstrap).toHaveBeenCalled();
    expect(result).toEqual({ path: '/login', query: { redirect: '/session/abc' } });
  });

  it('redirects authenticated users away from login', async () => {
    const guard = beforeEachGuard as (to: any) => Promise<any>;
    authStore.bootstrapped = true;
    authStore.isAuthenticated = true;

    expect(await guard({ path: '/login', fullPath: '/login', query: { redirect: '/admin' } })).toBe('/admin');
    expect(await guard({ path: '/login', fullPath: '/login', query: { redirect: 'http://evil' } })).toBe('/');
    expect(await guard({ path: '/login', fullPath: '/login', query: { redirect: ['bad'] } })).toBe('/');
  });

  it('protects admin route and allows other authenticated routes', async () => {
    const guard = beforeEachGuard as (to: any) => Promise<any>;
    authStore.bootstrapped = true;
    authStore.isAuthenticated = true;
    authStore.user = { role: 'USER' };
    expect(await guard({ path: '/admin', fullPath: '/admin', query: {} })).toBe('/');

    authStore.user = { role: 'ADMIN' };
    expect(await guard({ path: '/admin', fullPath: '/admin', query: {} })).toBe(true);
    expect(await guard({ path: '/session/abc', fullPath: '/session/abc', query: {} })).toBe(true);
  });
});
