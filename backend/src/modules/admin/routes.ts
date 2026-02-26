import { FastifyInstance } from 'fastify';
import { UserRole } from '@prisma/client';
import { z } from 'zod';
import { jiraService } from '../jira/service.js';
import { oidcConfigService } from './oidc-config.js';

const updateSchema = z.object({
  baseUrl: z.string().url().optional(),
  email: z.string().email().optional(),
  apiToken: z.string().min(8).optional(),
  defaultStoryPointsFieldId: z.string().min(1).optional(),
  projectFieldMappings: z.record(z.string(), z.string()).optional(),
});

const oidcUpdateSchema = z.object({
  enabled: z.boolean(),
  issuerUrl: z.string().url().optional(),
  clientId: z.string().min(1).optional(),
  clientSecret: z.string().min(1).optional(),
  redirectUri: z.string().url().optional(),
});

const ensureAdmin = (role?: UserRole) => role === 'ADMIN';

export const adminRoutes = async (app: FastifyInstance) => {
  app.get('/admin/jira/field-mappings', async (request, reply) => {
    if (!request.currentUser || !ensureAdmin(request.currentUser.role)) {
      return reply.code(403).send({ error: 'NOT_ENOUGH_RIGHTS' });
    }

    const config = await jiraService.getConfig();
    return {
      config: {
        baseUrl: config?.baseUrl ?? '',
        email: config?.email ?? '',
        defaultStoryPointsFieldId: config?.defaultStoryPointsFieldId ?? 'customfield_10016',
        projectFieldMappings: config?.projectFieldMappings ?? {},
      },
    };
  });

  app.put('/admin/jira/field-mappings', async (request, reply) => {
    if (!request.currentUser || !ensureAdmin(request.currentUser.role)) {
      return reply.code(403).send({ error: 'NOT_ENOUGH_RIGHTS' });
    }

    const payload = updateSchema.parse(request.body);
    const config = await jiraService.updateFieldMappings(payload);

    return {
      config: {
        baseUrl: config.baseUrl,
        email: config.email,
        defaultStoryPointsFieldId: config.defaultStoryPointsFieldId,
        projectFieldMappings: config.projectFieldMappings,
      },
    };
  });

  app.get('/admin/oidc/config', async (request, reply) => {
    if (!request.currentUser || !ensureAdmin(request.currentUser.role)) {
      return reply.code(403).send({ error: 'NOT_ENOUGH_RIGHTS' });
    }

    const config = await oidcConfigService.getAdminConfig();
    return { config };
  });

  app.put('/admin/oidc/config', async (request, reply) => {
    if (!request.currentUser || !ensureAdmin(request.currentUser.role)) {
      return reply.code(403).send({ error: 'NOT_ENOUGH_RIGHTS' });
    }

    const payload = oidcUpdateSchema.parse(request.body);

    if (payload.enabled) {
      if (!payload.issuerUrl || !payload.clientId || !payload.clientSecret || !payload.redirectUri) {
        return reply.code(422).send({ error: 'OIDC_CONFIG_INCOMPLETE' });
      }
    }

    const config = await oidcConfigService.updateConfig(payload);
    return { config };
  });
};
