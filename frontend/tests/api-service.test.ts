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
    isAxiosError: jest.fn((value) => Boolean(value?.isAxiosError)),
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

  it('extracts API error codes from axios and generic errors', async () => {
    let apiModule: any;
    jest.isolateModules(() => {
      apiModule = require('../src/services/api');
    });

    expect(apiModule.getApiErrorCode({
      isAxiosError: true,
      response: { data: { error: 'JIRA_INVALID_CREDENTIALS' } },
    })).toBe('JIRA_INVALID_CREDENTIALS');

    expect(apiModule.getApiErrorCode({
      isAxiosError: true,
      response: { data: { error: 123 } },
    })).toBe('');

    expect(apiModule.getApiErrorCode({
      isAxiosError: true,
      response: { data: { message: 'JIRA_BAD_REQUEST' } },
    })).toBe('JIRA_BAD_REQUEST');

    expect(apiModule.getApiErrorCode(new Error('GENERIC_FAILURE'))).toBe('GENERIC_FAILURE');
    expect(apiModule.getApiErrorCode({ foo: 'bar' })).toBe('');

    expect(apiModule.getApiErrorMessage({
      isAxiosError: true,
      response: { data: { message: 'Field customfield_20000 cannot be set.' } },
    })).toBe('Field customfield_20000 cannot be set.');

    expect(apiModule.getApiErrorMessage({
      isAxiosError: true,
      response: { data: { message: 123 } },
    })).toBe('');

    expect(apiModule.getApiErrorMessage({
      isAxiosError: true,
      response: { data: { message: 'JIRA_BAD_REQUEST' } },
    })).toBe('');

    expect(apiModule.getApiErrorDetails({
      isAxiosError: true,
      response: { data: { details: { issueKey: 'PROJ-1', storyPointsFieldId: 'customfield_20000' } } },
    })).toEqual({ issueKey: 'PROJ-1', storyPointsFieldId: 'customfield_20000' });

    expect(apiModule.getApiErrorDetails({
      isAxiosError: true,
      response: { data: { details: 'invalid' } },
    })).toBeNull();

    expect(apiModule.getApiErrorMessage(new Error('GENERIC_FAILURE'))).toBe('GENERIC_FAILURE');
    expect(apiModule.getApiErrorDetails(new Error('GENERIC_FAILURE'))).toBeNull();
    expect(apiModule.getApiErrorMessage({ foo: 'bar' })).toBe('');
  });
});
