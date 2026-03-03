export {};

let mountedHook: (() => Promise<void> | void) | null = null;

const route: any = {
  query: {},
};

const apiGetMock = jest.fn();

jest.mock('vue', () => ({
  defineComponent: (component: unknown) => component,
  ref: (value: unknown) => ({ value }),
  onMounted: (callback: () => Promise<void> | void) => {
    mountedHook = callback;
  },
}));

jest.mock('vue-router', () => ({
  useRoute: () => route,
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('../src/stores/auth', () => ({
  useAuthStore: () => ({
    register: jest.fn(),
    login: jest.fn(),
  }),
}));

jest.mock('../src/services/api', () => ({
  api: {
    get: (...args: unknown[]) => apiGetMock(...args),
  },
}));

describe('LoginView OIDC return handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mountedHook = null;
    route.query = {};
    apiGetMock.mockResolvedValue({ data: { enabled: false, transparentLogin: true } });
    (global as any).window = {
      location: {
        assign: jest.fn(),
      },
    };

    jest.isolateModules(() => {
      const component = require('../src/views/LoginView.vue').default;
      component.setup?.({}, { expose: () => undefined });
    });
  });

  it('redirects to backend callback when code and state are present', async () => {
    route.query = { code: 'abc123', state: 'xyz789' };

    await (mountedHook as () => Promise<void>)();

    expect(window.location.assign).toHaveBeenCalledWith(
      '/api/auth/oidc/callback?code=abc123&state=xyz789',
    );
    expect(apiGetMock).not.toHaveBeenCalled();
  });

  it('loads OIDC config when no callback parameters are present', async () => {
    route.query = {};
    apiGetMock.mockResolvedValueOnce({ data: { enabled: false, transparentLogin: true } });

    await (mountedHook as () => Promise<void>)();

    expect(window.location.assign).not.toHaveBeenCalled();
    expect(apiGetMock).toHaveBeenCalledWith('/auth/oidc/config');
  });

  it('starts transparent oidc login when oidc is enabled and transparent mode is on', async () => {
    route.query = { redirect: '/session/abc' };
    apiGetMock.mockResolvedValueOnce({ data: { enabled: true, transparentLogin: true } });

    await (mountedHook as () => Promise<void>)();

    expect(window.location.assign).toHaveBeenCalledWith(
      '/api/auth/oidc/login?redirect=%2Fsession%2Fabc',
    );
  });

  it('does not auto start oidc login when transparent mode is off', async () => {
    route.query = { redirect: '/session/abc' };
    apiGetMock.mockResolvedValueOnce({ data: { enabled: true, transparentLogin: false } });

    await (mountedHook as () => Promise<void>)();

    expect(window.location.assign).not.toHaveBeenCalled();
    expect(apiGetMock).toHaveBeenCalledWith('/auth/oidc/config');
  });
});