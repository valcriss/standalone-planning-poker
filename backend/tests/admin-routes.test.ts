import Fastify from 'fastify';
import { adminRoutes } from '../src/modules/admin/routes.js';
import { jiraService } from '../src/modules/jira/service.js';
import { oidcConfigService } from '../src/modules/admin/oidc-config.js';

jest.mock('../src/modules/jira/service.js', () => ({
  jiraService: {
    getConfig: jest.fn(),
    updateFieldMappings: jest.fn(),
  },
}));

jest.mock('../src/modules/admin/oidc-config.js', () => ({
  oidcConfigService: {
    getAdminConfig: jest.fn(),
    updateConfig: jest.fn(),
  },
}));

const buildApp = async (currentUser: { role: 'ADMIN' | 'USER' } | null) => {
  const app = Fastify();
  app.decorateRequest('currentUser', null);
  app.addHook('preHandler', async (request) => {
    request.currentUser = currentUser as any;
  });

  await app.register(adminRoutes, { prefix: '/api' });
  return app;
};

describe('admin routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 403 when user is not admin', async () => {
    const app = await buildApp(null);

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/jira/field-mappings',
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'NOT_ENOUGH_RIGHTS' });
    await app.close();
  });

  it('returns jira config defaults for admin', async () => {
    (jiraService.getConfig as jest.Mock).mockResolvedValueOnce(null);
    const app = await buildApp({ role: 'ADMIN' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/jira/field-mappings',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      config: {
        baseUrl: '',
        email: '',
        defaultStoryPointsFieldId: 'customfield_10016',
        projectFieldMappings: {},
      },
    });
    await app.close();
  });

  it('returns 422 when enabled oidc payload is incomplete', async () => {
    const app = await buildApp({ role: 'ADMIN' });

    const response = await app.inject({
      method: 'PUT',
      url: '/api/admin/oidc/config',
      payload: {
        enabled: true,
        issuerUrl: 'https://issuer.example.com',
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ error: 'OIDC_CONFIG_INCOMPLETE' });
    expect(oidcConfigService.updateConfig).not.toHaveBeenCalled();
    await app.close();
  });

  it('updates oidc config when payload is valid', async () => {
    (oidcConfigService.updateConfig as jest.Mock).mockResolvedValueOnce({ id: 'oidc-config' });
    const app = await buildApp({ role: 'ADMIN' });

    const payload = {
      enabled: true,
      issuerUrl: 'https://issuer.example.com',
      clientId: 'client-id',
      clientSecret: 'secret',
      redirectUri: 'https://app.example.com/callback',
    };

    const response = await app.inject({
      method: 'PUT',
      url: '/api/admin/oidc/config',
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(oidcConfigService.updateConfig).toHaveBeenCalledWith(payload);
    expect(response.json()).toEqual({ config: { id: 'oidc-config' } });
    await app.close();
  });

  it('updates oidc config when oidc is disabled without requiring full payload', async () => {
    (oidcConfigService.updateConfig as jest.Mock).mockResolvedValueOnce({ id: 'oidc-config', enabled: false });
    const app = await buildApp({ role: 'ADMIN' });

    const response = await app.inject({
      method: 'PUT',
      url: '/api/admin/oidc/config',
      payload: { enabled: false },
    });

    expect(response.statusCode).toBe(200);
    expect(oidcConfigService.updateConfig).toHaveBeenCalledWith({ enabled: false });
    await app.close();
  });

  it('updates jira field mappings for admin', async () => {
    (jiraService.updateFieldMappings as jest.Mock).mockResolvedValueOnce({
      baseUrl: 'https://jira.example.com',
      email: 'jira@example.com',
      defaultStoryPointsFieldId: 'customfield_1',
      projectFieldMappings: { PROJ: 'customfield_2' },
    });
    const app = await buildApp({ role: 'ADMIN' });

    const response = await app.inject({
      method: 'PUT',
      url: '/api/admin/jira/field-mappings',
      payload: {
        baseUrl: 'https://jira.example.com',
        email: 'jira@example.com',
        apiToken: 'token-1234',
        defaultStoryPointsFieldId: 'customfield_1',
        projectFieldMappings: { PROJ: 'customfield_2' },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(jiraService.updateFieldMappings).toHaveBeenCalled();
    expect(response.json().config.defaultStoryPointsFieldId).toBe('customfield_1');
    await app.close();
  });

  it('returns admin oidc config for admin user', async () => {
    (oidcConfigService.getAdminConfig as jest.Mock).mockResolvedValueOnce({ id: 'oidc-config', enabled: false });
    const app = await buildApp({ role: 'ADMIN' });
    const response = await app.inject({ method: 'GET', url: '/api/admin/oidc/config' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ config: { id: 'oidc-config', enabled: false } });
    await app.close();
  });

  it('returns 403 for non-admin on other admin endpoints', async () => {
    const app = await buildApp({ role: 'USER' });

    const putJira = await app.inject({
      method: 'PUT',
      url: '/api/admin/jira/field-mappings',
      payload: {},
    });
    const getOidc = await app.inject({ method: 'GET', url: '/api/admin/oidc/config' });
    const putOidc = await app.inject({
      method: 'PUT',
      url: '/api/admin/oidc/config',
      payload: { enabled: false },
    });

    expect(putJira.statusCode).toBe(403);
    expect(getOidc.statusCode).toBe(403);
    expect(putOidc.statusCode).toBe(403);
    await app.close();
  });
});
