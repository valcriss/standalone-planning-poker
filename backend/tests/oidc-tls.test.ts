import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

describe('oidcService TLS config', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('uses OIDC_CA_CERT_PATH when provided', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oidc-ca-'));
    const certPath = path.join(tempDir, 'internal-ca.pem');
    fs.writeFileSync(certPath, 'CERTIFICATE');

    const axiosModule = (await import('axios')).default as {
      get: jest.Mock;
      post: jest.Mock;
    };
    const { env } = await import('../src/config.js');
    const { oidcConfigService } = await import('../src/modules/admin/oidc-config.js');
    const { oidcService } = await import('../src/modules/auth/oidc.js');

    env.OIDC_CA_CERT_PATH = certPath;
    env.OIDC_TLS_INSECURE = false;

    (oidcConfigService.getRuntimeConfig as jest.Mock).mockResolvedValue({
      issuerUrl: 'https://issuer.example.com',
      clientId: 'client-id',
      redirectUri: 'https://app.example.com/callback',
    });

    axiosModule.get.mockResolvedValueOnce({
      data: {
        authorization_endpoint: 'https://issuer.example.com/oauth2/authorize',
        token_endpoint: 'https://issuer.example.com/oauth2/token',
        userinfo_endpoint: 'https://issuer.example.com/oauth2/userinfo',
      },
    });

    await oidcService.getAuthorizationUrl('state-123');

    expect(axiosModule.get).toHaveBeenCalledWith(
      'https://issuer.example.com/.well-known/openid-configuration',
      expect.objectContaining({
        httpsAgent: expect.any(Object),
      }),
    );

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('throws explicit error when OIDC_CA_CERT_PATH cannot be read', async () => {
    const axiosModule = (await import('axios')).default as {
      get: jest.Mock;
      post: jest.Mock;
    };
    const { env } = await import('../src/config.js');
    const { oidcConfigService } = await import('../src/modules/admin/oidc-config.js');
    const { oidcService } = await import('../src/modules/auth/oidc.js');

    env.OIDC_CA_CERT_PATH = path.join(os.tmpdir(), `missing-ca-${Date.now()}.pem`);
    env.OIDC_TLS_INSECURE = false;

    (oidcConfigService.getRuntimeConfig as jest.Mock).mockResolvedValue({
      issuerUrl: 'https://issuer.example.com',
      clientId: 'client-id',
      redirectUri: 'https://app.example.com/callback',
    });

    axiosModule.get.mockResolvedValueOnce({
      data: {
        authorization_endpoint: 'https://issuer.example.com/oauth2/authorize',
        token_endpoint: 'https://issuer.example.com/oauth2/token',
        userinfo_endpoint: 'https://issuer.example.com/oauth2/userinfo',
      },
    });

    await expect(oidcService.getAuthorizationUrl('state-456')).rejects.toThrow('OIDC_CA_CERT_READ_FAILED:');
  });

  it('handles non-Error values thrown while reading OIDC_CA_CERT_PATH', async () => {
    const axiosModule = (await import('axios')).default as {
      get: jest.Mock;
      post: jest.Mock;
    };
    const { env } = await import('../src/config.js');
    const { oidcConfigService } = await import('../src/modules/admin/oidc-config.js');
    const { oidcService } = await import('../src/modules/auth/oidc.js');

    jest.spyOn(fs, 'readFileSync').mockImplementationOnce(() => {
      throw 'raw-failure';
    });

    env.OIDC_CA_CERT_PATH = '/tmp/non-error-ca.pem';
    env.OIDC_TLS_INSECURE = false;

    (oidcConfigService.getRuntimeConfig as jest.Mock).mockResolvedValue({
      issuerUrl: 'https://issuer.example.com',
      clientId: 'client-id',
      redirectUri: 'https://app.example.com/callback',
    });

    axiosModule.get.mockResolvedValueOnce({
      data: {
        authorization_endpoint: 'https://issuer.example.com/oauth2/authorize',
        token_endpoint: 'https://issuer.example.com/oauth2/token',
        userinfo_endpoint: 'https://issuer.example.com/oauth2/userinfo',
      },
    });

    await expect(oidcService.getAuthorizationUrl('state-789')).rejects.toThrow(
      'OIDC_CA_CERT_READ_FAILED: raw-failure',
    );
  });
});
