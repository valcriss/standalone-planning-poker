import Fastify from 'fastify';
import { jiraRoutes } from '../src/modules/jira/routes.js';
import { jiraService } from '../src/modules/jira/service.js';

jest.mock('../src/modules/jira/service.js', () => ({
  jiraService: {
    listProjectsForUser: jest.fn(),
    listStatusesByProjectForUser: jest.fn(),
    listIssuesByProjectForUser: jest.fn(),
    getIssueByKeyForUser: jest.fn(),
  },
}));

const buildApp = async (currentUser: { id: string } | null) => {
  const app = Fastify();
  app.decorateRequest('currentUser', null);
  app.addHook('preHandler', async (request) => {
    request.currentUser = currentUser as any;
  });
  await app.register(jiraRoutes, { prefix: '/api' });
  return app;
};

describe('jira routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    const app = await buildApp(null);
    const response = await app.inject({ method: 'GET', url: '/api/jira/projects' });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('returns projects for authenticated user', async () => {
    (jiraService.listProjectsForUser as jest.Mock).mockResolvedValueOnce([{ key: 'PRJ' }]);
    const app = await buildApp({ id: 'u1' });

    const response = await app.inject({ method: 'GET', url: '/api/jira/projects' });

    expect(response.statusCode).toBe(200);
    expect(jiraService.listProjectsForUser).toHaveBeenCalledWith('u1');
    expect(response.json()).toEqual({ items: [{ key: 'PRJ' }] });
    await app.close();
  });

  it('returns statuses for project', async () => {
    (jiraService.listStatusesByProjectForUser as jest.Mock).mockResolvedValueOnce([{ name: 'Done' }]);
    const app = await buildApp({ id: 'u1' });

    const response = await app.inject({ method: 'GET', url: '/api/jira/projects/abc/statuses' });

    expect(response.statusCode).toBe(200);
    expect(jiraService.listStatusesByProjectForUser).toHaveBeenCalledWith('u1', 'abc');
    await app.close();
  });

  it('passes optional status query when listing issues', async () => {
    (jiraService.listIssuesByProjectForUser as jest.Mock).mockResolvedValueOnce([]);
    const app = await buildApp({ id: 'u1' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/jira/projects/abc/issues?status=In%20Progress',
    });

    expect(response.statusCode).toBe(200);
    expect(jiraService.listIssuesByProjectForUser).toHaveBeenCalledWith('u1', 'abc', {
      statusName: 'In Progress',
    });
    await app.close();
  });

  it('uppercases issue key when fetching a single issue', async () => {
    (jiraService.getIssueByKeyForUser as jest.Mock).mockResolvedValueOnce({ key: 'ABC-1' });
    const app = await buildApp({ id: 'u1' });

    const response = await app.inject({ method: 'GET', url: '/api/jira/issues/abc-1' });

    expect(response.statusCode).toBe(200);
    expect(jiraService.getIssueByKeyForUser).toHaveBeenCalledWith('u1', 'ABC-1');
    expect(response.json()).toEqual({ item: { key: 'ABC-1' } });
    await app.close();
  });

  it('returns 401 on protected jira endpoints when unauthenticated', async () => {
    const app = await buildApp(null);

    const statuses = await app.inject({ method: 'GET', url: '/api/jira/projects/abc/statuses' });
    const issues = await app.inject({ method: 'GET', url: '/api/jira/projects/abc/issues' });
    const issue = await app.inject({ method: 'GET', url: '/api/jira/issues/abc-1' });

    expect(statuses.statusCode).toBe(401);
    expect(issues.statusCode).toBe(401);
    expect(issue.statusCode).toBe(401);
    await app.close();
  });
});
