import axios from 'axios';
import { oidcService } from '../src/modules/auth/oidc.js';
import { oidcConfigService } from '../src/modules/admin/oidc-config.js';
import { prisma } from '../src/prisma.js';
import { authService } from '../src/modules/auth/service.js';

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

jest.mock('../src/modules/admin/oidc-config.js', () => ({
  oidcConfigService: {
    getRuntimeConfig: jest.fn(),
  },
}));

jest.mock('../src/prisma.js', () => ({
  prisma: {
    user: {
      upsert: jest.fn(),
    },
  },
}));

jest.mock('../src/modules/auth/service.js', () => ({
  authService: {
    getUserById: jest.fn(),
    signAccessToken: jest.fn(),
    issueRefreshToken: jest.fn(),
  },
}));

describe('oidcService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('builds authorization url from discovery and runtime config', async () => {
    (oidcConfigService.getRuntimeConfig as jest.Mock).mockResolvedValue({
      issuerUrl: 'https://issuer.example.com/',
      clientId: 'client-id',
      redirectUri: 'https://app.example.com/callback',
    });
    (axios.get as jest.Mock).mockResolvedValueOnce({
      data: {
        authorization_endpoint: 'https://issuer.example.com/oauth2/authorize',
        token_endpoint: 'https://issuer.example.com/oauth2/token',
        userinfo_endpoint: 'https://issuer.example.com/oauth2/userinfo',
      },
    });

    const url = await oidcService.getAuthorizationUrl('state-123');

    expect(url).toContain('response_type=code');
    expect(url).toContain('client_id=client-id');
    expect(url).toContain('redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback');
    expect(url).toContain('state=state-123');
  });

  it('throws when authorization url config is incomplete', async () => {
    (oidcConfigService.getRuntimeConfig as jest.Mock).mockResolvedValue({
      issuerUrl: 'https://issuer.example.com',
      clientId: '',
      redirectUri: '',
    });

    await expect(oidcService.getAuthorizationUrl('state-1')).rejects.toThrow('OIDC_NOT_CONFIGURED');
  });

  it('throws when issuer url is missing during discovery', async () => {
    (oidcConfigService.getRuntimeConfig as jest.Mock).mockResolvedValue({
      clientId: 'client-id',
      redirectUri: 'https://app.example.com/callback',
    });

    await expect(oidcService.getAuthorizationUrl('state-issuer-missing')).rejects.toThrow('OIDC_NOT_CONFIGURED');
  });

  it('exchanges code for user info', async () => {
    (oidcConfigService.getRuntimeConfig as jest.Mock).mockResolvedValue({
      issuerUrl: 'https://issuer.example.com',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'https://app.example.com/callback',
    });
    (axios.get as jest.Mock)
      .mockResolvedValueOnce({
        data: {
          authorization_endpoint: 'https://issuer.example.com/oauth2/authorize',
          token_endpoint: 'https://issuer.example.com/oauth2/token',
          userinfo_endpoint: 'https://issuer.example.com/oauth2/userinfo',
        },
      })
      .mockResolvedValueOnce({
        data: { sub: 'sub-1', email: 'user@example.com', name: 'User Name' },
      });
    (axios.post as jest.Mock).mockResolvedValueOnce({
      data: { access_token: 'access-token' },
    });

    const user = await oidcService.exchangeCodeForUser('code-123');

    expect(axios.post).toHaveBeenCalledWith(
      'https://issuer.example.com/oauth2/token',
      expect.stringContaining('code=code-123'),
      expect.any(Object),
    );
    expect(user).toEqual({ sub: 'sub-1', email: 'user@example.com', name: 'User Name' });
  });

  it('throws when exchange config is incomplete', async () => {
    (oidcConfigService.getRuntimeConfig as jest.Mock).mockResolvedValue({
      issuerUrl: 'https://issuer.example.com',
      clientId: 'client-id',
      clientSecret: '',
      redirectUri: 'https://app.example.com/callback',
    });

    await expect(oidcService.exchangeCodeForUser('code-123')).rejects.toThrow('OIDC_NOT_CONFIGURED');
  });

  it('generates random state', () => {
    const state = oidcService.randomState();
    expect(typeof state).toBe('string');
    expect(state.length).toBeGreaterThan(10);
  });

  it('upserts oidc user with normalized email and fallback display name', async () => {
    (prisma.user.upsert as jest.Mock).mockResolvedValueOnce({ id: 'u1' });
    await oidcService.upsertUserFromOidc({
      sub: 'sub-1',
      email: 'USER@EXAMPLE.COM',
      preferred_username: 'preferred',
    });

    expect(prisma.user.upsert).toHaveBeenCalledWith({
      where: { email: 'user@example.com' },
      update: { displayName: 'preferred' },
      create: {
        email: 'user@example.com',
        displayName: 'preferred',
        passwordHash: null,
      },
    });
  });

  it('falls back to email as display name when name and preferred username are missing', async () => {
    (prisma.user.upsert as jest.Mock).mockResolvedValueOnce({ id: 'u2' });

    await oidcService.upsertUserFromOidc({
      sub: 'sub-2',
      email: 'email-only@example.com',
    });

    expect(prisma.user.upsert).toHaveBeenCalledWith({
      where: { email: 'email-only@example.com' },
      update: { displayName: 'email-only@example.com' },
      create: {
        email: 'email-only@example.com',
        displayName: 'email-only@example.com',
        passwordHash: null,
      },
    });
  });

  it('throws when oidc user has no email', async () => {
    await expect(oidcService.upsertUserFromOidc({ sub: 'sub-1' })).rejects.toThrow('OIDC_EMAIL_MISSING');
  });

  it('builds session tokens for existing user', async () => {
    (authService.getUserById as jest.Mock).mockResolvedValueOnce({ id: 'u1', email: 'user@example.com' });
    (authService.signAccessToken as jest.Mock).mockReturnValueOnce('access-token');
    (authService.issueRefreshToken as jest.Mock).mockResolvedValueOnce('refresh-token');

    const result = await oidcService.buildSessionTokens('u1');

    expect(result).toEqual({
      user: { id: 'u1', email: 'user@example.com' },
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });
  });

  it('throws when building session tokens for unknown user', async () => {
    (authService.getUserById as jest.Mock).mockResolvedValueOnce(null);
    await expect(oidcService.buildSessionTokens('missing')).rejects.toThrow('USER_NOT_FOUND');
  });
});
