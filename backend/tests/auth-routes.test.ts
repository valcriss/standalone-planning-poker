import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { authRoutes } from '../src/modules/auth/routes.js';
import { authService } from '../src/modules/auth/service.js';
import { oidcConfigService } from '../src/modules/admin/oidc-config.js';
import { oidcService } from '../src/modules/auth/oidc.js';
import { jiraService } from '../src/modules/jira/service.js';

jest.mock('../src/config.js', () => ({
  env: {
    NODE_ENV: 'test',
    APP_BASE_URL: 'http://localhost:5174',
    REFRESH_COOKIE_NAME: 'pp_refresh_token',
    JWT_REFRESH_TTL_DAYS: 7,
  },
}));

jest.mock('../src/modules/auth/service.js', () => ({
  authService: {
    register: jest.fn(),
    login: jest.fn(),
    signAccessToken: jest.fn(),
    issueRefreshToken: jest.fn(),
    rotateRefreshToken: jest.fn(),
    revokeRefreshToken: jest.fn(),
    updateAvatar: jest.fn(),
    getUserById: jest.fn(),
    updateDisplayName: jest.fn(),
  },
}));

jest.mock('../src/modules/admin/oidc-config.js', () => ({
  oidcConfigService: {
    getRuntimeConfig: jest.fn(),
  },
}));

jest.mock('../src/modules/auth/oidc.js', () => ({
  oidcService: {
    randomState: jest.fn(),
    getAuthorizationUrl: jest.fn(),
    exchangeCodeForUser: jest.fn(),
    upsertUserFromOidc: jest.fn(),
    buildSessionTokens: jest.fn(),
  },
}));

jest.mock('../src/modules/jira/service.js', () => ({
  jiraService: {
    testUserCredentialsPayload: jest.fn(),
    upsertUserCredentials: jest.fn(),
    getUserJiraProfile: jest.fn(),
  },
}));

const user = {
  id: 'u1',
  email: 'u1@example.com',
  displayName: 'User One',
  role: 'USER' as const,
  avatarDataUrl: null,
  jiraBaseUrl: null,
  jiraEmail: null,
  jiraApiTokenEncrypted: null,
};

const buildApp = async (currentUser: any = null) => {
  const app = Fastify();
  await app.register(cookie);
  app.decorateRequest('currentUser', null);
  app.addHook('preHandler', async (request) => {
    request.currentUser = currentUser;
  });
  await app.register(authRoutes, { prefix: '/api' });
  return app;
};

describe('auth routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (oidcConfigService.getRuntimeConfig as jest.Mock).mockResolvedValue({ enabled: false });
  });

  it('returns oidc runtime config', async () => {
    (oidcConfigService.getRuntimeConfig as jest.Mock).mockResolvedValueOnce({ enabled: true });
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/auth/oidc/config' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ enabled: true, loginPath: '/api/auth/oidc/login' });
    await app.close();
  });

  it('blocks local register when oidc is enabled', async () => {
    (oidcConfigService.getRuntimeConfig as jest.Mock).mockResolvedValueOnce({ enabled: true });
    const app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'x@y.com', displayName: 'User', password: 'password123' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'LOCAL_AUTH_DISABLED' });
    await app.close();
  });

  it('registers user and sets refresh cookie', async () => {
    (authService.register as jest.Mock).mockResolvedValueOnce(user);
    (authService.signAccessToken as jest.Mock).mockReturnValueOnce('access-token');
    (authService.issueRefreshToken as jest.Mock).mockResolvedValueOnce('refresh-token');
    const app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'x@y.com', displayName: 'User', password: 'password123' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['set-cookie']).toBeDefined();
    expect(response.json()).toEqual({
      accessToken: 'access-token',
      user: {
        id: 'u1',
        email: 'u1@example.com',
        displayName: 'User One',
        role: 'USER',
        avatarDataUrl: null,
        hasJiraCredentials: false,
      },
    });
    await app.close();
  });

  it('returns 401 on refresh without cookie', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'POST', url: '/api/auth/refresh' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'MISSING_REFRESH_TOKEN' });
    await app.close();
  });

  it('returns current user on /auth/me', async () => {
    const app = await buildApp(user);
    const response = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(response.statusCode).toBe(200);
    expect(response.json().user.id).toBe('u1');
    await app.close();
  });

  it('returns 401 on /auth/me when unauthenticated', async () => {
    const app = await buildApp(null);
    const response = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('blocks profile displayName change when oidc is enabled', async () => {
    (oidcConfigService.getRuntimeConfig as jest.Mock).mockResolvedValueOnce({ enabled: true });
    const app = await buildApp(user);

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      payload: {
        displayName: 'Another Name',
        jiraBaseUrl: 'https://jira.example.com',
        jiraEmail: 'jira@example.com',
        jiraToken: '',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'PROFILE_UPDATE_DISABLED_FOR_OIDC' });
    expect(jiraService.testUserCredentialsPayload).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns 404 on oidc login when disabled', async () => {
    (oidcConfigService.getRuntimeConfig as jest.Mock).mockResolvedValueOnce({ enabled: false });
    const app = await buildApp();

    const response = await app.inject({ method: 'GET', url: '/api/auth/oidc/login' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'OIDC_DISABLED' });
    await app.close();
  });

  it('sets state cookies and redirects on oidc login', async () => {
    (oidcConfigService.getRuntimeConfig as jest.Mock).mockResolvedValueOnce({ enabled: true });
    (oidcService.randomState as jest.Mock).mockReturnValueOnce('state-123');
    (oidcService.getAuthorizationUrl as jest.Mock).mockResolvedValueOnce('https://issuer.example.com/auth');
    const app = await buildApp();

    const response = await app.inject({ method: 'GET', url: '/api/auth/oidc/login?redirect=/admin' });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('https://issuer.example.com/auth');
    expect(response.headers['set-cookie']).toBeDefined();
    await app.close();
  });

  it('rejects oidc callback with invalid query/state', async () => {
    (oidcConfigService.getRuntimeConfig as jest.Mock).mockResolvedValue({ enabled: true });
    const app = await buildApp();

    const invalidQuery = await app.inject({ method: 'GET', url: '/api/auth/oidc/callback' });
    expect(invalidQuery.statusCode).toBe(400);
    expect(invalidQuery.json()).toEqual({ error: 'INVALID_OIDC_CALLBACK_QUERY' });

    const invalidState = await app.inject({
      method: 'GET',
      url: '/api/auth/oidc/callback?code=abc&state=state-2',
      cookies: { oidc_state: 'state-1' },
    });
    expect(invalidState.statusCode).toBe(400);
    expect(invalidState.json()).toEqual({ error: 'INVALID_OIDC_STATE' });

    await app.close();
  });

  it('creates session and redirects on successful oidc callback', async () => {
    (oidcConfigService.getRuntimeConfig as jest.Mock).mockResolvedValue({ enabled: true });
    (oidcService.exchangeCodeForUser as jest.Mock).mockResolvedValueOnce({ sub: 'sub-1', email: 'u@example.com' });
    (oidcService.upsertUserFromOidc as jest.Mock).mockResolvedValueOnce({ id: 'u1' });
    (oidcService.buildSessionTokens as jest.Mock).mockResolvedValueOnce({
      refreshToken: 'refresh-token',
    });
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/oidc/callback?code=abc&state=state-1',
      cookies: {
        oidc_state: 'state-1',
        oidc_redirect: '/admin',
      },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('http://localhost:5174/admin');
    await app.close();
  });

  it('logs in user and sets refresh cookie', async () => {
    (authService.login as jest.Mock).mockResolvedValueOnce(user);
    (authService.signAccessToken as jest.Mock).mockReturnValueOnce('access-token');
    (authService.issueRefreshToken as jest.Mock).mockResolvedValueOnce('refresh-token');
    const app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'x@y.com', password: 'password123' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['set-cookie']).toBeDefined();
    const cookies = ([] as string[]).concat(response.headers['set-cookie'] as any);
    const refreshCookie = cookies.find((value) => value.startsWith('pp_refresh_token='));
    expect(refreshCookie).toBeDefined();
    expect(refreshCookie).not.toContain('Secure');
    expect(response.json().accessToken).toBe('access-token');
    await app.close();
  });

  it('sets secure refresh cookie when request is forwarded as https', async () => {
    (authService.login as jest.Mock).mockResolvedValueOnce(user);
    (authService.signAccessToken as jest.Mock).mockReturnValueOnce('access-token');
    (authService.issueRefreshToken as jest.Mock).mockResolvedValueOnce('refresh-token');
    const app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-forwarded-proto': 'https' },
      payload: { email: 'x@y.com', password: 'password123' },
    });

    expect(response.statusCode).toBe(200);
    const cookies = ([] as string[]).concat(response.headers['set-cookie'] as any);
    const refreshCookie = cookies.find((value) => value.startsWith('pp_refresh_token='));
    expect(refreshCookie).toContain('Secure');
    await app.close();
  });

  it('sets secure refresh cookie when forwarded proto header is an array', async () => {
    (authService.login as jest.Mock).mockResolvedValueOnce(user);
    (authService.signAccessToken as jest.Mock).mockReturnValueOnce('access-token');
    (authService.issueRefreshToken as jest.Mock).mockResolvedValueOnce('refresh-token');
    const app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-forwarded-proto': ['https', 'http'] as any },
      payload: { email: 'x@y.com', password: 'password123' },
    });

    expect(response.statusCode).toBe(200);
    const cookies = ([] as string[]).concat(response.headers['set-cookie'] as any);
    const refreshCookie = cookies.find((value) => value.startsWith('pp_refresh_token='));
    expect(refreshCookie).toContain('Secure');
    await app.close();
  });

  it('refreshes access token when refresh cookie exists', async () => {
    (authService.rotateRefreshToken as jest.Mock).mockResolvedValueOnce({
      user,
      refreshToken: 'next-refresh-token',
    });
    (authService.signAccessToken as jest.Mock).mockReturnValueOnce('next-access-token');
    const app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: { pp_refresh_token: 'old-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(authService.rotateRefreshToken).toHaveBeenCalledWith('old-token');
    expect(response.json().accessToken).toBe('next-access-token');
    await app.close();
  });

  it('revokes refresh token on logout when cookie is set', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { pp_refresh_token: 'refresh-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(authService.revokeRefreshToken).toHaveBeenCalledWith('refresh-token');
    expect(response.json()).toEqual({ ok: true });
    await app.close();
  });

  it('logs out without revocation when refresh token cookie is missing', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
    });

    expect(response.statusCode).toBe(200);
    expect(authService.revokeRefreshToken).not.toHaveBeenCalled();
    expect(response.json()).toEqual({ ok: true });
    await app.close();
  });

  it('updates avatar for authenticated user', async () => {
    (authService.updateAvatar as jest.Mock).mockResolvedValueOnce(user);
    const app = await buildApp(user);

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/auth/me/avatar',
      payload: { avatarDataUrl: 'data:image/png;base64,AAA=' },
    });

    expect(response.statusCode).toBe(200);
    expect(authService.updateAvatar).toHaveBeenCalledWith('u1', 'data:image/png;base64,AAA=');
    await app.close();
  });

  it('returns 401 on avatar update when unauthenticated', async () => {
    const app = await buildApp(null);
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/auth/me/avatar',
      payload: { avatarDataUrl: null },
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('updates jira profile and displayName when local auth is enabled', async () => {
    (oidcConfigService.getRuntimeConfig as jest.Mock).mockResolvedValueOnce({ enabled: false });
    (jiraService.testUserCredentialsPayload as jest.Mock).mockResolvedValueOnce({ ok: true });
    (jiraService.upsertUserCredentials as jest.Mock).mockResolvedValueOnce({});
    (authService.getUserById as jest.Mock).mockResolvedValueOnce(user);
    (authService.updateDisplayName as jest.Mock).mockResolvedValueOnce({ ...user, displayName: 'New Name' });
    const app = await buildApp(user);

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      payload: {
        displayName: '  New Name  ',
        jiraBaseUrl: 'https://jira.example.com',
        jiraEmail: 'jira@example.com',
        jiraToken: 'tok',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(jiraService.testUserCredentialsPayload).toHaveBeenCalled();
    expect(jiraService.upsertUserCredentials).toHaveBeenCalled();
    expect(authService.updateDisplayName).toHaveBeenCalledWith('u1', 'New Name');
    await app.close();
  });

  it('returns 404 when user disappeared during profile update', async () => {
    (oidcConfigService.getRuntimeConfig as jest.Mock).mockResolvedValueOnce({ enabled: false });
    (jiraService.testUserCredentialsPayload as jest.Mock).mockResolvedValueOnce({ ok: true });
    (jiraService.upsertUserCredentials as jest.Mock).mockResolvedValueOnce({});
    (authService.getUserById as jest.Mock).mockResolvedValueOnce(null);
    const app = await buildApp(user);

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      payload: {
        displayName: 'Name',
        jiraBaseUrl: 'https://jira.example.com',
        jiraEmail: 'jira@example.com',
        jiraToken: '',
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'USER_NOT_FOUND' });
    await app.close();
  });

  it('tests jira credentials endpoint for authenticated user', async () => {
    (jiraService.testUserCredentialsPayload as jest.Mock).mockResolvedValueOnce({ ok: true });
    const app = await buildApp(user);
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/me/jira/test',
      payload: {
        jiraBaseUrl: 'https://jira.example.com',
        jiraEmail: 'jira@example.com',
        jiraToken: 'tok',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    await app.close();
  });

  it('returns jira profile endpoint result', async () => {
    (jiraService.getUserJiraProfile as jest.Mock).mockResolvedValueOnce({ isConfigured: true });
    const app = await buildApp(user);
    const response = await app.inject({ method: 'GET', url: '/api/auth/me/jira' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ isConfigured: true });
    await app.close();
  });

  it('returns 404 on oidc callback when oidc disabled', async () => {
    (oidcConfigService.getRuntimeConfig as jest.Mock).mockResolvedValueOnce({ enabled: false });
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/auth/oidc/callback?code=x&state=y' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'OIDC_DISABLED' });
    await app.close();
  });

  it('blocks local login when oidc is enabled', async () => {
    (oidcConfigService.getRuntimeConfig as jest.Mock).mockResolvedValueOnce({ enabled: true });
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'x@y.com', password: 'x' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'LOCAL_AUTH_DISABLED' });
    await app.close();
  });

  it('returns 401 on profile/jira endpoints when unauthenticated', async () => {
    const app = await buildApp(null);

    const mePatch = await app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      payload: {
        displayName: 'Name',
        jiraBaseUrl: 'https://jira.example.com',
        jiraEmail: 'jira@example.com',
        jiraToken: '',
      },
    });
    const jiraTest = await app.inject({
      method: 'POST',
      url: '/api/auth/me/jira/test',
      payload: {
        jiraBaseUrl: 'https://jira.example.com',
        jiraEmail: 'jira@example.com',
        jiraToken: '',
      },
    });
    const jiraGet = await app.inject({ method: 'GET', url: '/api/auth/me/jira' });

    expect(mePatch.statusCode).toBe(401);
    expect(jiraTest.statusCode).toBe(401);
    expect(jiraGet.statusCode).toBe(401);
    await app.close();
  });

  it('marks hasJiraCredentials=true when user has jira fields', async () => {
    const app = await buildApp({
      ...user,
      jiraBaseUrl: 'https://jira.example.com',
      jiraEmail: 'jira@example.com',
      jiraApiTokenEncrypted: 'enc',
    });
    const response = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(response.statusCode).toBe(200);
    expect(response.json().user.hasJiraCredentials).toBe(true);
    await app.close();
  });

  it('sanitizes unsafe redirects in oidc login/callback', async () => {
    (oidcConfigService.getRuntimeConfig as jest.Mock).mockResolvedValue({ enabled: true });
    (oidcService.randomState as jest.Mock).mockReturnValue('state-123');
    (oidcService.getAuthorizationUrl as jest.Mock).mockResolvedValue('https://issuer.example.com/auth');
    (oidcService.exchangeCodeForUser as jest.Mock).mockResolvedValue({ sub: 'sub-1', email: 'u@example.com' });
    (oidcService.upsertUserFromOidc as jest.Mock).mockResolvedValue({ id: 'u1' });
    (oidcService.buildSessionTokens as jest.Mock).mockResolvedValue({ refreshToken: 'refresh-token' });
    const app = await buildApp();

    const login = await app.inject({ method: 'GET', url: '/api/auth/oidc/login?redirect=//evil.com' });
    expect(login.statusCode).toBe(302);

    const callback = await app.inject({
      method: 'GET',
      url: '/api/auth/oidc/callback?code=abc&state=state-123',
      cookies: {
        oidc_state: 'state-123',
        oidc_redirect: '//evil.com',
      },
    });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe('http://localhost:5174/');
    await app.close();
  });

  it('falls back to root redirect when oidc login query is invalid', async () => {
    (oidcConfigService.getRuntimeConfig as jest.Mock).mockResolvedValue({ enabled: true });
    (oidcService.randomState as jest.Mock).mockReturnValue('state-123');
    (oidcService.getAuthorizationUrl as jest.Mock).mockResolvedValue('https://issuer.example.com/auth');
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/oidc/login?redirect=/ok&redirect=/second',
    });

    expect(response.statusCode).toBe(302);
    const cookies = ([] as string[]).concat(response.headers['set-cookie'] as any);
    const redirectCookie = cookies.find((value) => value.startsWith('oidc_redirect='));
    expect(redirectCookie).toContain('oidc_redirect=%2F;');
    await app.close();
  });

  it('does not update displayName when unchanged in local mode', async () => {
    (oidcConfigService.getRuntimeConfig as jest.Mock).mockResolvedValueOnce({ enabled: false });
    (jiraService.testUserCredentialsPayload as jest.Mock).mockResolvedValueOnce({ ok: true });
    (jiraService.upsertUserCredentials as jest.Mock).mockResolvedValueOnce({});
    (authService.getUserById as jest.Mock).mockResolvedValueOnce(user);
    const app = await buildApp(user);

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      payload: {
        displayName: user.displayName,
        jiraBaseUrl: 'https://jira.example.com',
        jiraEmail: 'jira@example.com',
        jiraToken: '',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(authService.updateDisplayName).not.toHaveBeenCalled();
    await app.close();
  });
});
