const prismaMock = {
  oidcConfig: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

jest.mock('../src/prisma.js', () => ({
  prisma: prismaMock,
}));

jest.mock('../src/config.js', () => ({
  env: {
    OIDC_ENABLED: true,
    OIDC_ISSUER_URL: 'https://issuer.example.com',
    OIDC_CLIENT_ID: 'client-id',
    OIDC_CLIENT_SECRET: 'client-secret',
    OIDC_REDIRECT_URI: 'https://app.example.com/callback',
  },
}));

import { oidcConfigService } from '../src/modules/admin/oidc-config.js';

describe('oidcConfigService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns env runtime config when no db config exists', async () => {
    prismaMock.oidcConfig.findUnique.mockResolvedValueOnce(null);

    const config = await oidcConfigService.getRuntimeConfig();

    expect(config).toEqual({
      enabled: true,
      issuerUrl: 'https://issuer.example.com',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'https://app.example.com/callback',
    });
  });

  it('returns db runtime config and normalizes null values', async () => {
    prismaMock.oidcConfig.findUnique.mockResolvedValueOnce({
      enabled: false,
      issuerUrl: null,
      clientId: 'db-client-id',
      clientSecret: null,
      redirectUri: 'https://db.example.com/callback',
    });

    const config = await oidcConfigService.getRuntimeConfig();

    expect(config).toEqual({
      enabled: false,
      issuerUrl: undefined,
      clientId: 'db-client-id',
      clientSecret: undefined,
      redirectUri: 'https://db.example.com/callback',
    });
  });

  it('returns admin fallback config when no db config exists', async () => {
    prismaMock.oidcConfig.findUnique.mockResolvedValueOnce(null);

    const config = await oidcConfigService.getAdminConfig();

    expect(config.id).toBe('oidc-config');
    expect(config.enabled).toBe(true);
    expect(config.issuerUrl).toBe('https://issuer.example.com');
    expect(config.clientId).toBe('client-id');
    expect(config.clientSecret).toBe('client-secret');
    expect(config.redirectUri).toBe('https://app.example.com/callback');
    expect(config.updatedAt).toBeInstanceOf(Date);
  });

  it('returns admin config from database when present', async () => {
    const dbConfig = { id: 'oidc-config', enabled: false, updatedAt: new Date() };
    prismaMock.oidcConfig.findUnique.mockResolvedValueOnce(dbConfig);
    const config = await oidcConfigService.getAdminConfig();
    expect(config).toBe(dbConfig);
  });

  it('creates config when none exists', async () => {
    prismaMock.oidcConfig.findUnique.mockResolvedValueOnce(null);
    prismaMock.oidcConfig.create.mockResolvedValueOnce({ id: 'oidc-config' });

    await oidcConfigService.updateConfig({
      enabled: true,
      issuerUrl: 'https://issuer2.example.com',
      clientId: 'client-2',
      clientSecret: 'secret-2',
      redirectUri: 'https://app.example.com/callback-2',
    });

    expect(prismaMock.oidcConfig.create).toHaveBeenCalledWith({
      data: {
        id: 'oidc-config',
        enabled: true,
        issuerUrl: 'https://issuer2.example.com',
        clientId: 'client-2',
        clientSecret: 'secret-2',
        redirectUri: 'https://app.example.com/callback-2',
      },
    });
  });

  it('updates config when it exists', async () => {
    prismaMock.oidcConfig.findUnique.mockResolvedValueOnce({ id: 'oidc-config' });
    prismaMock.oidcConfig.update.mockResolvedValueOnce({ id: 'oidc-config' });

    await oidcConfigService.updateConfig({
      enabled: false,
      issuerUrl: undefined,
      clientId: 'client-3',
      clientSecret: undefined,
      redirectUri: undefined,
    });

    expect(prismaMock.oidcConfig.update).toHaveBeenCalledWith({
      where: { id: 'oidc-config' },
      data: {
        enabled: false,
        issuerUrl: null,
        clientId: 'client-3',
        clientSecret: null,
        redirectUri: null,
      },
    });
  });

  it('normalizes null fields from db runtime config', async () => {
    prismaMock.oidcConfig.findUnique.mockResolvedValueOnce({
      enabled: true,
      issuerUrl: 'https://issuer.example.com',
      clientId: null,
      clientSecret: 'secret',
      redirectUri: null,
    });

    const config = await oidcConfigService.getRuntimeConfig();
    expect(config.clientId).toBeUndefined();
    expect(config.redirectUri).toBeUndefined();
  });

  it('returns nullable admin env fallback values when env values are undefined', async () => {
    prismaMock.oidcConfig.findUnique.mockResolvedValueOnce(null);
    const { env } = jest.requireMock('../src/config.js');
    env.OIDC_ISSUER_URL = undefined;
    env.OIDC_CLIENT_ID = undefined;
    env.OIDC_CLIENT_SECRET = undefined;
    env.OIDC_REDIRECT_URI = undefined;

    const config = await oidcConfigService.getAdminConfig();
    expect(config.issuerUrl).toBeNull();
    expect(config.clientId).toBeNull();
    expect(config.clientSecret).toBeNull();
    expect(config.redirectUri).toBeNull();
  });

  it('creates and updates config with null optional fields when missing', async () => {
    prismaMock.oidcConfig.findUnique.mockResolvedValueOnce(null);
    prismaMock.oidcConfig.create.mockResolvedValueOnce({ id: 'oidc-config' });

    await oidcConfigService.updateConfig({ enabled: true });
    expect(prismaMock.oidcConfig.create).toHaveBeenCalledWith({
      data: {
        id: 'oidc-config',
        enabled: true,
        issuerUrl: null,
        clientId: null,
        clientSecret: null,
        redirectUri: null,
      },
    });

    prismaMock.oidcConfig.findUnique.mockResolvedValueOnce({ id: 'oidc-config' });
    prismaMock.oidcConfig.update.mockResolvedValueOnce({ id: 'oidc-config' });
    await oidcConfigService.updateConfig({ enabled: false, issuerUrl: 'https://issuer.example.com' });
    expect(prismaMock.oidcConfig.update).toHaveBeenCalledWith({
      where: { id: 'oidc-config' },
      data: {
        enabled: false,
        issuerUrl: 'https://issuer.example.com',
        clientId: null,
        clientSecret: null,
        redirectUri: null,
      },
    });
  });
});
