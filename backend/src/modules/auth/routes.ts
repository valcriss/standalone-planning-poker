import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authService } from './service.js';
import { env } from '../../config.js';
import { oidcService } from './oidc.js';
import { oidcConfigService } from '../admin/oidc-config.js';
import { jiraService } from '../jira/service.js';

const registerSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(2).max(120),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
const updateAvatarSchema = z.object({
  avatarDataUrl: z
    .string()
    .regex(/^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/)
    .max(2_000_000)
    .nullable(),
});
const updateProfileSchema = z.object({
  displayName: z.string().min(2).max(120),
  jiraBaseUrl: z.string().url(),
  jiraEmail: z.string().email(),
  jiraToken: z.string().optional().default(''),
});
const jiraTestSchema = z.object({
  jiraBaseUrl: z.string().url(),
  jiraEmail: z.string().email(),
  jiraToken: z.string().optional().default(''),
});

const toPublicUser = (user: {
  id: string;
  email: string;
  displayName: string;
  role: 'ADMIN' | 'USER';
  avatarDataUrl: string | null;
  jiraBaseUrl?: string | null;
  jiraEmail?: string | null;
  jiraApiTokenEncrypted?: string | null;
}) => ({
  id: user.id,
  email: user.email,
  displayName: user.displayName,
  role: user.role,
  avatarDataUrl: user.avatarDataUrl,
  hasJiraCredentials: !!user.jiraBaseUrl && !!user.jiraEmail && !!user.jiraApiTokenEncrypted,
});

export const authRoutes = async (app: FastifyInstance) => {
  app.get('/auth/oidc/config', async () => ({
    enabled: (await oidcConfigService.getRuntimeConfig()).enabled,
    loginPath: '/api/auth/oidc/login',
  }));

  app.get('/auth/oidc/login', async (request, reply) => {
    const oidcRuntimeConfig = await oidcConfigService.getRuntimeConfig();

    if (!oidcRuntimeConfig.enabled) {
      return reply.code(404).send({ error: 'OIDC_DISABLED' });
    }

    const query = z
      .object({
        redirect: z.string().optional(),
      })
      .safeParse(request.query);

    const requestedRedirect = query.success ? query.data.redirect : undefined;
    const safeRedirect =
      requestedRedirect && requestedRedirect.startsWith('/') && !requestedRedirect.startsWith('//')
        ? requestedRedirect
        : '/';

    const state = oidcService.randomState();
    const redirectUrl = await oidcService.getAuthorizationUrl(state);

    reply.setCookie('oidc_state', state, {
      path: '/api/auth/oidc/callback',
      httpOnly: true,
      sameSite: 'lax',
      secure: env.NODE_ENV === 'production',
      maxAge: 300,
    });
    reply.setCookie('oidc_redirect', safeRedirect, {
      path: '/api/auth/oidc/callback',
      httpOnly: true,
      sameSite: 'lax',
      secure: env.NODE_ENV === 'production',
      maxAge: 300,
    });

    return reply.redirect(redirectUrl);
  });

  app.get('/auth/oidc/callback', async (request, reply) => {
    const oidcRuntimeConfig = await oidcConfigService.getRuntimeConfig();

    if (!oidcRuntimeConfig.enabled) {
      return reply.code(404).send({ error: 'OIDC_DISABLED' });
    }

    const query = z
      .object({
        code: z.string().min(1),
        state: z.string().min(1),
      })
      .safeParse(request.query);

    if (!query.success) {
      return reply.code(400).send({ error: 'INVALID_OIDC_CALLBACK_QUERY' });
    }

    const expectedState = request.cookies.oidc_state;

    if (!expectedState || expectedState !== query.data.state) {
      return reply.code(400).send({ error: 'INVALID_OIDC_STATE' });
    }

    const userInfo = await oidcService.exchangeCodeForUser(query.data.code);
    const user = await oidcService.upsertUserFromOidc(userInfo);
    const tokens = await oidcService.buildSessionTokens(user.id);

    const requestedRedirect = request.cookies.oidc_redirect;
    const safeRedirect =
      requestedRedirect && requestedRedirect.startsWith('/') && !requestedRedirect.startsWith('//')
        ? requestedRedirect
        : '/';

    reply.clearCookie('oidc_state', { path: '/api/auth/oidc/callback' });
    reply.clearCookie('oidc_redirect', { path: '/api/auth/oidc/callback' });
    reply.setCookie(env.REFRESH_COOKIE_NAME, tokens.refreshToken, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: env.NODE_ENV === 'production',
      maxAge: env.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60,
    });

    return reply.redirect(`${env.APP_BASE_URL}${safeRedirect}`);
  });

  app.post('/auth/register', async (request, reply) => {
    const oidcRuntimeConfig = await oidcConfigService.getRuntimeConfig();

    if (oidcRuntimeConfig.enabled) {
      return reply.code(403).send({ error: 'LOCAL_AUTH_DISABLED' });
    }

    const payload = registerSchema.parse(request.body);
    const user = await authService.register(payload.email, payload.displayName, payload.password);
    const accessToken = authService.signAccessToken(user);
    const refreshToken = await authService.issueRefreshToken(user.id);

    reply.setCookie(env.REFRESH_COOKIE_NAME, refreshToken, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: env.NODE_ENV === 'production',
      maxAge: env.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60,
    });

    return {
      accessToken,
      user: toPublicUser(user),
    };
  });

  app.post('/auth/login', async (request, reply) => {
    const oidcRuntimeConfig = await oidcConfigService.getRuntimeConfig();

    if (oidcRuntimeConfig.enabled) {
      return reply.code(403).send({ error: 'LOCAL_AUTH_DISABLED' });
    }

    const payload = loginSchema.parse(request.body);
    const user = await authService.login(payload.email, payload.password);
    const accessToken = authService.signAccessToken(user);
    const refreshToken = await authService.issueRefreshToken(user.id);

    reply.setCookie(env.REFRESH_COOKIE_NAME, refreshToken, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: env.NODE_ENV === 'production',
      maxAge: env.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60,
    });

    return {
      accessToken,
      user: toPublicUser(user),
    };
  });

  app.post('/auth/refresh', async (request, reply) => {
    const refreshToken = request.cookies[env.REFRESH_COOKIE_NAME];

    if (!refreshToken) {
      return reply.code(401).send({ error: 'MISSING_REFRESH_TOKEN' });
    }

    const { user, refreshToken: nextRefreshToken } =
      await authService.rotateRefreshToken(refreshToken);

    reply.setCookie(env.REFRESH_COOKIE_NAME, nextRefreshToken, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: env.NODE_ENV === 'production',
      maxAge: env.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60,
    });

    return {
      accessToken: authService.signAccessToken(user),
      user: toPublicUser(user),
    };
  });

  app.post('/auth/logout', async (request, reply) => {
    const refreshToken = request.cookies[env.REFRESH_COOKIE_NAME];

    if (refreshToken) {
      await authService.revokeRefreshToken(refreshToken);
    }

    reply.clearCookie(env.REFRESH_COOKIE_NAME, { path: '/' });
    return { ok: true };
  });

  app.get('/auth/me', async (request, reply) => {
    if (!request.currentUser) {
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }

    return { user: toPublicUser(request.currentUser) };
  });

  app.patch('/auth/me/avatar', async (request, reply) => {
    if (!request.currentUser) {
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }

    const payload = updateAvatarSchema.parse(request.body);
    const user = await authService.updateAvatar(request.currentUser.id, payload.avatarDataUrl);

    return { user: toPublicUser(user) };
  });

  app.patch('/auth/me', async (request, reply) => {
    if (!request.currentUser) {
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }

    const payload = updateProfileSchema.parse(request.body);
    const oidcRuntimeConfig = await oidcConfigService.getRuntimeConfig();
    if (oidcRuntimeConfig.enabled && payload.displayName.trim() !== request.currentUser.displayName) {
      return reply.code(403).send({ error: 'PROFILE_UPDATE_DISABLED_FOR_OIDC' });
    }

    await jiraService.testUserCredentialsPayload({
      userId: request.currentUser.id,
      baseUrl: payload.jiraBaseUrl,
      email: payload.jiraEmail,
      apiToken: payload.jiraToken,
    });
    await jiraService.upsertUserCredentials(request.currentUser.id, {
      baseUrl: payload.jiraBaseUrl,
      email: payload.jiraEmail,
      apiToken: payload.jiraToken,
    });

    let user = await authService.getUserById(request.currentUser.id);
    if (!user) {
      return reply.code(404).send({ error: 'USER_NOT_FOUND' });
    }

    if (!oidcRuntimeConfig.enabled && payload.displayName.trim() !== user.displayName) {
      user = await authService.updateDisplayName(request.currentUser.id, payload.displayName.trim());
    }

    return { user: toPublicUser(user) };
  });

  app.post('/auth/me/jira/test', async (request, reply) => {
    if (!request.currentUser) {
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }

    const payload = jiraTestSchema.parse(request.body);
    await jiraService.testUserCredentialsPayload({
      userId: request.currentUser.id,
      baseUrl: payload.jiraBaseUrl,
      email: payload.jiraEmail,
      apiToken: payload.jiraToken,
    });

    return { ok: true };
  });

  app.get('/auth/me/jira', async (request, reply) => {
    if (!request.currentUser) {
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }

    const jiraProfile = await jiraService.getUserJiraProfile(request.currentUser.id);
    return jiraProfile;
  });
};
