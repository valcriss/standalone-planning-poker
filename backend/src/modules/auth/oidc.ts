import axios from 'axios';
import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import { env } from '../../config.js';
import { prisma } from '../../prisma.js';
import { authService } from './service.js';
import { oidcConfigService } from '../admin/oidc-config.js';

type OidcDiscovery = {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
};

type OidcUserInfo = {
  sub: string;
  email?: string;
  name?: string;
  preferred_username?: string;
};

let oidcHttpsAgent: https.Agent | undefined;

const getOidcHttpsAgent = () => {
  if (oidcHttpsAgent) {
    return oidcHttpsAgent;
  }

  const rejectUnauthorized = !env.OIDC_TLS_INSECURE;
  let ca: string | undefined;

  if (env.OIDC_CA_CERT_PATH) {
    try {
      ca = fs.readFileSync(env.OIDC_CA_CERT_PATH, 'utf8');
    } catch (error) {
      const reason = String(error);
      throw new Error(`OIDC_CA_CERT_READ_FAILED: ${reason}`);
    }
  }

  oidcHttpsAgent = new https.Agent({
    keepAlive: true,
    rejectUnauthorized,
    ...(ca ? { ca } : {}),
  });

  return oidcHttpsAgent;
};

const getDiscovery = async (): Promise<OidcDiscovery> => {
  const runtimeConfig = await oidcConfigService.getRuntimeConfig();

  if (!runtimeConfig.issuerUrl) {
    throw new Error('OIDC_NOT_CONFIGURED');
  }

  const issuer = runtimeConfig.issuerUrl.replace(/\/$/, '');
  const { data } = await axios.get<OidcDiscovery>(`${issuer}/.well-known/openid-configuration`, {
    httpsAgent: getOidcHttpsAgent(),
  });

  return data;
};

export const oidcService = {
  async getAuthorizationUrl(state: string) {
    const runtimeConfig = await oidcConfigService.getRuntimeConfig();

    if (!runtimeConfig.clientId || !runtimeConfig.redirectUri) {
      throw new Error('OIDC_NOT_CONFIGURED');
    }

    const discovery = await getDiscovery();
    const url = new URL(discovery.authorization_endpoint);

    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', runtimeConfig.clientId);
    url.searchParams.set('redirect_uri', runtimeConfig.redirectUri);
    url.searchParams.set('scope', 'openid profile email');
    url.searchParams.set('state', state);

    return url.toString();
  },

  async exchangeCodeForUser(code: string): Promise<OidcUserInfo> {
    const runtimeConfig = await oidcConfigService.getRuntimeConfig();

    if (!runtimeConfig.clientId || !runtimeConfig.clientSecret || !runtimeConfig.redirectUri) {
      throw new Error('OIDC_NOT_CONFIGURED');
    }

    const discovery = await getDiscovery();
    const tokenParams = new URLSearchParams();

    tokenParams.set('grant_type', 'authorization_code');
    tokenParams.set('code', code);
    tokenParams.set('client_id', runtimeConfig.clientId);
    tokenParams.set('client_secret', runtimeConfig.clientSecret);
    tokenParams.set('redirect_uri', runtimeConfig.redirectUri);

    const tokenResponse = await axios.post<{ access_token: string }>(
      discovery.token_endpoint,
      tokenParams.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        httpsAgent: getOidcHttpsAgent(),
      },
    );

    const { data } = await axios.get<OidcUserInfo>(discovery.userinfo_endpoint, {
      headers: {
        Authorization: `Bearer ${tokenResponse.data.access_token}`,
      },
      httpsAgent: getOidcHttpsAgent(),
    });

    return data;
  },

  randomState() {
    return crypto.randomBytes(24).toString('base64url');
  },

  async upsertUserFromOidc(userInfo: OidcUserInfo) {
    if (!userInfo.email) {
      throw new Error('OIDC_EMAIL_MISSING');
    }

    const email = userInfo.email.toLowerCase();
    const displayName = userInfo.name || userInfo.preferred_username || email;

    return prisma.user.upsert({
      where: { email },
      update: {
        displayName,
      },
      create: {
        email,
        displayName,
        passwordHash: null,
      },
    });
  },

  async buildSessionTokens(userId: string) {
    const user = await authService.getUserById(userId);

    if (!user) {
      throw new Error('USER_NOT_FOUND');
    }

    const accessToken = authService.signAccessToken(user);
    const refreshToken = await authService.issueRefreshToken(user.id);

    return {
      user,
      accessToken,
      refreshToken,
    };
  },
};
