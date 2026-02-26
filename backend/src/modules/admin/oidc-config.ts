import { prisma } from '../../prisma.js';
import { env } from '../../config.js';

export type RuntimeOidcConfig = {
  enabled: boolean;
  issuerUrl?: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
};

const fromEnv = (): RuntimeOidcConfig => ({
  enabled: env.OIDC_ENABLED,
  issuerUrl: env.OIDC_ISSUER_URL,
  clientId: env.OIDC_CLIENT_ID,
  clientSecret: env.OIDC_CLIENT_SECRET,
  redirectUri: env.OIDC_REDIRECT_URI,
});

export const oidcConfigService = {
  async getRuntimeConfig(): Promise<RuntimeOidcConfig> {
    const config = await prisma.oidcConfig.findUnique({ where: { id: 'oidc-config' } });

    if (!config) {
      return fromEnv();
    }

    return {
      enabled: config.enabled,
      issuerUrl: config.issuerUrl ?? undefined,
      clientId: config.clientId ?? undefined,
      clientSecret: config.clientSecret ?? undefined,
      redirectUri: config.redirectUri ?? undefined,
    };
  },

  async getAdminConfig() {
    const config = await prisma.oidcConfig.findUnique({ where: { id: 'oidc-config' } });

    if (config) {
      return config;
    }

    return {
      id: 'oidc-config',
      enabled: env.OIDC_ENABLED,
      issuerUrl: env.OIDC_ISSUER_URL ?? null,
      clientId: env.OIDC_CLIENT_ID ?? null,
      clientSecret: env.OIDC_CLIENT_SECRET ?? null,
      redirectUri: env.OIDC_REDIRECT_URI ?? null,
      updatedAt: new Date(),
    };
  },

  async updateConfig(payload: {
    enabled: boolean;
    issuerUrl?: string;
    clientId?: string;
    clientSecret?: string;
    redirectUri?: string;
  }) {
    const existing = await prisma.oidcConfig.findUnique({ where: { id: 'oidc-config' } });

    if (!existing) {
      return prisma.oidcConfig.create({
        data: {
          id: 'oidc-config',
          enabled: payload.enabled,
          issuerUrl: payload.issuerUrl ?? null,
          clientId: payload.clientId ?? null,
          clientSecret: payload.clientSecret ?? null,
          redirectUri: payload.redirectUri ?? null,
        },
      });
    }

    return prisma.oidcConfig.update({
      where: { id: 'oidc-config' },
      data: {
        enabled: payload.enabled,
        issuerUrl: payload.issuerUrl ?? null,
        clientId: payload.clientId ?? null,
        clientSecret: payload.clientSecret ?? null,
        redirectUri: payload.redirectUri ?? null,
      },
    });
  },
};
