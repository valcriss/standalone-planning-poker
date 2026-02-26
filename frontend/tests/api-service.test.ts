export {};

const requestUse = jest.fn();
const responseUse = jest.fn();
const requestImpl = jest.fn();

const client = {
  interceptors: {
    request: { use: requestUse },
    response: { use: responseUse },
  },
  request: requestImpl,
};

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: jest.fn(() => client),
  },
}));

const authStore: any = {
  accessToken: '',
  refresh: jest.fn(),
  logout: jest.fn(),
};

jest.mock('../src/stores/auth', () => ({
  useAuthStore: () => authStore,
}));

describe('api service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authStore.accessToken = '';
  });

  it('adds bearer token when access token is present', async () => {
    jest.isolateModules(() => {
      require('../src/services/api');
    });
    const requestHandler = requestUse.mock.calls[0][0];

    authStore.accessToken = 'token-1';
    const result = requestHandler({ headers: {} });
    expect(result.headers.Authorization).toBe('Bearer token-1');

    authStore.accessToken = '';
    const noAuth = requestHandler({ headers: {} });
    expect(noAuth.headers.Authorization).toBeUndefined();
  });

  it('retries request after refresh on 401 and logs out when refresh fails', async () => {
    let apiModule: any;
    jest.isolateModules(() => {
      apiModule = require('../src/services/api');
    });

    const responseErrorHandler = responseUse.mock.calls[0][1];
    const passThroughHandler = responseUse.mock.calls[0][0];
    expect(passThroughHandler({ ok: true })).toEqual({ ok: true });

    authStore.accessToken = 'old-token';
    authStore.refresh.mockImplementation(async () => {
      authStore.accessToken = 'new-token';
    });
    requestImpl.mockResolvedValueOnce({ ok: true });

    const error = { response: { status: 401 }, config: { headers: {} } };
    const retried = await responseErrorHandler(error);
    expect(authStore.refresh).toHaveBeenCalled();
    expect(requestImpl).toHaveBeenCalledWith({
      headers: { Authorization: 'Bearer new-token' },
    });
    expect(retried).toEqual({ ok: true });

    authStore.refresh.mockRejectedValueOnce(new Error('refresh failed'));
    await expect(responseErrorHandler(error)).rejects.toBe(error);
    expect(authStore.logout).toHaveBeenCalled();

    authStore.accessToken = '';
    await expect(responseErrorHandler({ response: { status: 500 }, config: { headers: {} } })).rejects.toEqual({
      response: { status: 500 },
      config: { headers: {} },
    });
  });
});
