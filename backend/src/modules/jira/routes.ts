import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { jiraService } from './service.js';

export const jiraRoutes = async (app: FastifyInstance) => {
  app.get('/jira/projects', async (request, reply) => {
    if (!request.currentUser) {
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }

    const items = await jiraService.listProjectsForUser(request.currentUser!.id);
    return { items };
  });

  app.get('/jira/projects/:projectKey/statuses', async (request, reply) => {
    if (!request.currentUser) {
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }

    const params = z.object({ projectKey: z.string().min(1) }).parse(request.params);
    const items = await jiraService.listStatusesByProjectForUser(request.currentUser!.id, params.projectKey);
    return { items };
  });

  app.get('/jira/projects/:projectKey/issues', async (request, reply) => {
    if (!request.currentUser) {
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }

    const params = z.object({ projectKey: z.string().min(1) }).parse(request.params);
    const query = z
      .object({
        status: z.string().optional(),
      })
      .parse(request.query);
    const items = await jiraService.listIssuesByProjectForUser(request.currentUser!.id, params.projectKey, {
      statusName: query.status,
    });
    return { items };
  });

  app.get('/jira/issues/:issueKey', async (request, reply) => {
    if (!request.currentUser) {
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }

    const params = z.object({ issueKey: z.string().min(2) }).parse(request.params);
    const item = await jiraService.getIssueByKeyForUser(request.currentUser!.id, params.issueKey.toUpperCase());
    return { item };
  });
};
