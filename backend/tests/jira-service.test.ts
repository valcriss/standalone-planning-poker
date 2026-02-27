import { jiraService } from '../src/modules/jira/service.js';
import { prisma } from '../src/prisma.js';
import axios from 'axios';
import { decryptCredential, encryptCredential } from '../src/modules/jira/credentials-crypto.js';

jest.mock('../src/config.js', () => ({
  env: {
    JIRA_DEFAULT_STORY_POINTS_FIELD_ID: 'customfield_10016',
  },
}));

jest.mock('../src/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    jiraConfig: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock('../src/modules/jira/credentials-crypto.js', () => ({
  decryptCredential: jest.fn(),
  encryptCredential: jest.fn(),
}));

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: jest.fn(),
  },
}));

describe('jiraService', () => {
  const client = {
    get: jest.fn(),
    put: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (axios.create as jest.Mock).mockReturnValue(client);
    (decryptCredential as jest.Mock).mockReturnValue('decrypted-token');
    (encryptCredential as jest.Mock).mockImplementation((value: string) => `enc:${value}`);
    (prisma.jiraConfig.findUnique as jest.Mock).mockResolvedValue(null);
  });

  it('tests credentials via /myself', async () => {
    client.get.mockResolvedValueOnce({});
    await expect(
      jiraService.testCredentials({ baseUrl: 'https://jira.example.com', email: 'jira@example.com', apiToken: 'tok' }),
    ).resolves.toBe(true);
    expect(client.get).toHaveBeenCalledWith('/myself');
  });

  it('tests user payload with explicit token', async () => {
    const testSpy = jest.spyOn(jiraService, 'testCredentials').mockResolvedValueOnce(true);
    await jiraService.testUserCredentialsPayload({
      baseUrl: 'https://jira.example.com/',
      email: ' JIRA@EXAMPLE.COM ',
      apiToken: ' token ',
    });

    expect(testSpy).toHaveBeenCalledWith({
      baseUrl: 'https://jira.example.com/',
      email: 'jira@example.com',
      apiToken: 'token',
    });
  });

  it('falls back to stored token in testUserCredentialsPayload', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({ jiraApiTokenEncrypted: 'enc-old' });
    const testSpy = jest.spyOn(jiraService, 'testCredentials').mockResolvedValueOnce(true);

    await jiraService.testUserCredentialsPayload({
      userId: 'u1',
      baseUrl: 'https://jira.example.com',
      email: 'jira@example.com',
      apiToken: '',
    });

    expect(prisma.user.findUnique).toHaveBeenCalled();
    expect(decryptCredential).toHaveBeenCalledWith('enc-old');
    expect(testSpy).toHaveBeenCalledWith({
      baseUrl: 'https://jira.example.com',
      email: 'jira@example.com',
      apiToken: 'decrypted-token',
    });
  });

  it('throws when no token is available', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({ jiraApiTokenEncrypted: null });
    await expect(
      jiraService.testUserCredentialsPayload({
        userId: 'u1',
        baseUrl: 'https://jira.example.com',
        email: 'jira@example.com',
      }),
    ).rejects.toThrow('JIRA_NOT_CONFIGURED');
  });

  it('upserts user credentials with provided token', async () => {
    (prisma.user.update as jest.Mock).mockResolvedValueOnce({ id: 'u1' });

    await jiraService.upsertUserCredentials('u1', {
      baseUrl: 'https://jira.example.com/',
      email: ' JIRA@EXAMPLE.COM ',
      apiToken: ' token ',
    });

    expect(encryptCredential).toHaveBeenCalledWith('token');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: {
        jiraBaseUrl: 'https://jira.example.com',
        jiraEmail: 'jira@example.com',
        jiraApiTokenEncrypted: 'enc:token',
      },
    });
  });

  it('reuses stored token when upserting without apiToken', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({ jiraApiTokenEncrypted: 'stored-token' });
    (prisma.user.update as jest.Mock).mockResolvedValueOnce({ id: 'u1' });

    await jiraService.upsertUserCredentials('u1', {
      baseUrl: 'https://jira.example.com',
      email: 'jira@example.com',
    });

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ jiraApiTokenEncrypted: 'stored-token' }),
      }),
    );
  });

  it('throws when upserting credentials with missing required values', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({ jiraApiTokenEncrypted: '' });
    await expect(
      jiraService.upsertUserCredentials('u1', { baseUrl: '', email: 'jira@example.com', apiToken: '' }),
    ).rejects.toThrow('JIRA_NOT_CONFIGURED');
  });

  it('throws when upserting credentials without token and no existing user token', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(null);
    await expect(
      jiraService.upsertUserCredentials('u1', {
        baseUrl: 'https://jira.example.com',
        email: 'jira@example.com',
      }),
    ).rejects.toThrow('JIRA_NOT_CONFIGURED');
  });

  it('returns jira profile flags', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
      jiraBaseUrl: 'https://jira.example.com',
      jiraEmail: 'jira@example.com',
      jiraApiTokenEncrypted: 'enc',
    });

    const profile = await jiraService.getUserJiraProfile('u1');

    expect(profile).toEqual({
      jiraBaseUrl: 'https://jira.example.com',
      jiraEmail: 'jira@example.com',
      hasJiraToken: true,
      isConfigured: true,
    });
  });

  it('returns jira profile defaults when user has no jira data', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(null);
    const profile = await jiraService.getUserJiraProfile('u1');
    expect(profile).toEqual({
      jiraBaseUrl: '',
      jiraEmail: '',
      hasJiraToken: false,
      isConfigured: false,
    });
  });

  it('lists projects for user', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
      jiraBaseUrl: 'https://jira.example.com',
      jiraEmail: 'jira@example.com',
      jiraApiTokenEncrypted: 'enc',
    });
    client.get.mockResolvedValueOnce({
      data: { values: [{ id: '1', key: 'PROJ', name: 'Project' }] },
    });

    const projects = await jiraService.listProjectsForUser('u1');
    expect(projects).toEqual([{ id: '1', key: 'PROJ', name: 'Project' }]);
  });

  it('lists statuses with deduplication and sort', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
      jiraBaseUrl: 'https://jira.example.com',
      jiraEmail: 'jira@example.com',
      jiraApiTokenEncrypted: 'enc',
    });
    client.get.mockResolvedValueOnce({
      data: [
        { statuses: [{ id: '1', name: 'Done' }, { id: '2', name: 'To Do' }] },
        { statuses: [{ id: '3', name: 'Done' }, { id: '4', name: 'In Progress' }] },
      ],
    });

    const statuses = await jiraService.listStatusesByProjectForUser('u1', 'proj');
    expect(statuses).toEqual(['Done', 'In Progress', 'To Do']);
  });

  it('skips invalid status entries while listing statuses', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
      jiraBaseUrl: 'https://jira.example.com',
      jiraEmail: 'jira@example.com',
      jiraApiTokenEncrypted: 'enc',
    });
    client.get.mockResolvedValueOnce({
      data: [
        {},
        { statuses: [{ id: '1' }, { name: 'Done' }, { id: '2', name: 'In Progress' }] },
      ],
    });

    const statuses = await jiraService.listStatusesByProjectForUser('u1', 'proj');
    expect(statuses).toEqual(['In Progress']);
  });

  it('lists issues and filters out those already having story points', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
      jiraBaseUrl: 'https://jira.example.com',
      jiraEmail: 'jira@example.com',
      jiraApiTokenEncrypted: 'enc',
    });
    (prisma.jiraConfig.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'jira-config',
      defaultStoryPointsFieldId: 'customfield_42',
      projectFieldMappings: {},
    });
    client.get.mockResolvedValueOnce({
      data: {
        total: 2,
        issues: [
          {
            id: '1',
            key: 'PROJ-1',
            fields: { summary: 'A', status: { id: 's1', name: 'To Do' }, customfield_42: null },
          },
          {
            id: '2',
            key: 'PROJ-2',
            fields: { summary: 'B', status: { id: 's2', name: 'Done' }, customfield_42: 3 },
          },
        ],
      },
    });

    const issues = await jiraService.listIssuesByProjectForUser('u1', 'proj');
    expect(issues).toHaveLength(1);
    expect(issues[0].key).toBe('PROJ-1');
  });

  it('filters issues by status name when requested', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
      jiraBaseUrl: 'https://jira.example.com',
      jiraEmail: 'jira@example.com',
      jiraApiTokenEncrypted: 'enc',
    });
    client.get.mockResolvedValueOnce({
      data: {
        total: 2,
        issues: [
          { id: '1', key: 'PROJ-1', fields: { status: { id: 's1', name: 'To Do' }, customfield_10016: null } },
          {
            id: '2',
            key: 'PROJ-2',
            fields: { status: { id: 's2', name: 'In Progress' }, customfield_10016: null },
          },
        ],
      },
    });

    const issues = await jiraService.listIssuesByProjectForUser('u1', 'proj', { statusName: ' in progress ' });
    expect(issues).toHaveLength(1);
    expect(issues[0].key).toBe('PROJ-2');
  });

  it('handles status filter getter side effects for logging null fallback branch', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
      jiraBaseUrl: 'https://jira.example.com',
      jiraEmail: 'jira@example.com',
      jiraApiTokenEncrypted: 'enc',
    });
    client.get.mockResolvedValueOnce({
      data: {
        total: 1,
        issues: [
          { id: '1', key: 'PROJ-1', fields: { status: { id: 's1', name: 'In Progress' }, customfield_10016: null } },
        ],
      },
    });

    let readCount = 0;
    const filters: any = {};
    Object.defineProperty(filters, 'statusName', {
      get() {
        readCount += 1;
        return readCount === 1 ? 'In Progress' : undefined;
      },
    });

    const issues = await jiraService.listIssuesByProjectForUser('u1', 'proj', filters);
    expect(issues).toHaveLength(1);
  });

  it('lists issues when jira response has missing fields/total and returns defaults', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
      jiraBaseUrl: 'https://jira.example.com',
      jiraEmail: 'jira@example.com',
      jiraApiTokenEncrypted: 'enc',
    });
    client.get.mockResolvedValueOnce({
      data: {
        issues: [
          {
            id: '1',
            key: 'PROJ-1',
            fields: {
              customfield_10016: null,
            },
          },
        ],
      },
    });

    const issues = await jiraService.listIssuesByProjectForUser('u1', 'proj');
    expect(issues).toEqual([
      expect.objectContaining({
        id: '1',
        key: 'PROJ-1',
        summary: 'PROJ-1',
        statusId: 'unknown',
        statusName: 'Unknown',
      }),
    ]);
  });

  it('returns empty list when jira response has no issues array', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
      jiraBaseUrl: 'https://jira.example.com',
      jiraEmail: 'jira@example.com',
      jiraApiTokenEncrypted: 'enc',
    });
    client.get.mockResolvedValueOnce({ data: {} });

    const issues = await jiraService.listIssuesByProjectForUser('u1', 'proj');
    expect(issues).toEqual([]);
  });

  it('gets issue by key and extracts description text', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
      jiraBaseUrl: 'https://jira.example.com',
      jiraEmail: 'jira@example.com',
      jiraApiTokenEncrypted: 'enc',
    });
    client.get.mockResolvedValueOnce({
      data: {
        id: '1',
        key: 'PROJ-1',
        fields: {
          summary: 'Summary',
          description: {
            type: 'doc',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Line one' }] },
              { type: 'paragraph', content: [{ type: 'text', text: 'Line two' }] },
            ],
          },
        },
      },
    });

    const issue = await jiraService.getIssueByKeyForUser('u1', 'PROJ-1');
    expect(issue.description).toContain('Line one');
    expect(issue.description).toContain('Line two');
  });

  it('gets issue by key using session credentials', async () => {
    client.get.mockResolvedValueOnce({
      data: {
        id: '1',
        key: 'PROJ-1',
        fields: {
          summary: 'Summary',
          description: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'From session' }] }],
          },
        },
      },
    });

    const issue = await jiraService.getIssueByKeyForSession(
      {
        jiraBaseUrl: 'https://jira.example.com',
        jiraEmail: 'jira@example.com',
        jiraApiTokenEncrypted: 'enc',
      } as any,
      'PROJ-1',
    );

    expect(decryptCredential).toHaveBeenCalledWith('enc');
    expect(client.get).toHaveBeenCalledWith('/issue/PROJ-1?fields=summary,description');
    expect(issue).toEqual(
      expect.objectContaining({
        key: 'PROJ-1',
        summary: 'Summary',
        description: 'From session',
        browseUrl: 'https://jira.example.com/browse/PROJ-1',
      }),
    );
  });

  it('returns null descriptionAdf for session issue when description is missing', async () => {
    client.get.mockResolvedValueOnce({
      data: {
        id: '2',
        key: 'PROJ-2',
        fields: {
          summary: 'Summary 2',
        },
      },
    });

    const issue = await jiraService.getIssueByKeyForSession(
      {
        jiraBaseUrl: 'https://jira.example.com',
        jiraEmail: 'jira@example.com',
        jiraApiTokenEncrypted: 'enc',
      } as any,
      'PROJ-2',
    );

    expect(issue.description).toBe('');
    expect(issue.descriptionAdf).toBeNull();
  });

  it('handles empty/non-adf issue descriptions', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      jiraBaseUrl: 'https://jira.example.com',
      jiraEmail: 'jira@example.com',
      jiraApiTokenEncrypted: 'enc',
    });
    client.get.mockResolvedValueOnce({
      data: {
        id: '1',
        key: 'PROJ-1',
        fields: {
          summary: 'Summary',
          description: 123,
        },
      },
    });

    const issue = await jiraService.getIssueByKeyForUser('u1', 'PROJ-1');
    expect(issue.description).toBe('');
  });

  it('handles adf node object without text/content array and descriptionAdf fallback', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      jiraBaseUrl: 'https://jira.example.com',
      jiraEmail: 'jira@example.com',
      jiraApiTokenEncrypted: 'enc',
    });
    client.get.mockResolvedValueOnce({
      data: {
        id: '1',
        key: 'PROJ-1',
        fields: {
          summary: 'Summary',
          description: { type: 'paragraph' },
        },
      },
    });
    const issue = await jiraService.getIssueByKeyForUser('u1', 'PROJ-1');
    expect(issue.description).toBe('');

    client.get.mockResolvedValueOnce({
      data: {
        id: '2',
        key: 'PROJ-2',
        fields: {
          summary: 'Summary',
        },
      },
    });
    const noAdfIssue = await jiraService.getIssueByKeyForUser('u1', 'PROJ-2');
    expect(noAdfIssue.descriptionAdf).toBeNull();
  });

  it('throws when user jira credentials are missing', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
      jiraBaseUrl: null,
      jiraEmail: null,
      jiraApiTokenEncrypted: null,
    });
    await expect(jiraService.listProjectsForUser('u1')).rejects.toThrow('JIRA_NOT_CONFIGURED');
  });

  it('assigns story points with configured field mapping', async () => {
    (prisma.jiraConfig.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'jira-config',
      defaultStoryPointsFieldId: 'customfield_10016',
      projectFieldMappings: { PROJ: 'customfield_20000' },
    });
    client.put.mockResolvedValueOnce({});

    await jiraService.assignStoryPointsWithCredentials(
      { baseUrl: 'https://jira.example.com', email: 'jira@example.com', apiToken: 'tok' },
      'PROJ-1',
      'proj',
      8,
    );

    expect(client.put).toHaveBeenCalledWith('/issue/PROJ-1', {
      fields: {
        customfield_20000: 8,
      },
    });
  });

  it('assigns story points for session credentials', async () => {
    const assignSpy = jest.spyOn(jiraService, 'assignStoryPointsWithCredentials').mockResolvedValueOnce();

    await jiraService.assignStoryPointsForSession(
      {
        jiraBaseUrl: 'https://jira.example.com',
        jiraEmail: 'jira@example.com',
        jiraApiTokenEncrypted: 'enc',
      } as any,
      'PROJ-1',
      'PROJ',
      5,
    );

    expect(decryptCredential).toHaveBeenCalledWith('enc');
    expect(assignSpy).toHaveBeenCalledWith(
      {
        baseUrl: 'https://jira.example.com',
        email: 'jira@example.com',
        apiToken: 'decrypted-token',
      },
      'PROJ-1',
      'PROJ',
      5,
    );
  });

  it('creates field mapping config when missing', async () => {
    (prisma.jiraConfig.findUnique as jest.Mock).mockResolvedValueOnce(null);
    (prisma.jiraConfig.create as jest.Mock).mockResolvedValueOnce({ id: 'jira-config' });

    await jiraService.updateFieldMappings({
      baseUrl: 'https://jira.example.com',
      email: 'jira@example.com',
      apiToken: 'tok',
    });

    expect(prisma.jiraConfig.create).toHaveBeenCalled();
  });

  it('reads jira config via getConfig', async () => {
    (prisma.jiraConfig.findUnique as jest.Mock).mockResolvedValueOnce({ id: 'jira-config' });
    const config = await jiraService.getConfig();
    expect(config).toEqual({ id: 'jira-config' });
  });

  it('throws when creating mapping config without base jira credentials', async () => {
    (prisma.jiraConfig.findUnique as jest.Mock).mockResolvedValueOnce(null);
    await expect(jiraService.updateFieldMappings({ defaultStoryPointsFieldId: 'customfield_x' })).rejects.toThrow(
      'MISSING_JIRA_BASE_CONFIG',
    );
  });

  it('updates existing mapping config', async () => {
    (prisma.jiraConfig.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'jira-config',
      baseUrl: 'old-base',
      email: 'old-email',
      apiToken: 'old-token',
      defaultStoryPointsFieldId: 'old-field',
      projectFieldMappings: { OLD: 'customfield_old' },
    });
    (prisma.jiraConfig.update as jest.Mock).mockResolvedValueOnce({ id: 'jira-config' });

    await jiraService.updateFieldMappings({
      email: 'new-email',
      projectFieldMappings: { PROJ: 'customfield_1' },
    });

    expect(prisma.jiraConfig.update).toHaveBeenCalledWith({
      where: { id: 'jira-config' },
      data: {
        baseUrl: 'old-base',
        email: 'new-email',
        apiToken: 'old-token',
        defaultStoryPointsFieldId: 'old-field',
        projectFieldMappings: { PROJ: 'customfield_1' },
      },
    });
  });

  it('updates existing mapping config with fallbacks when payload fields are omitted', async () => {
    (prisma.jiraConfig.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'jira-config',
      baseUrl: 'old-base',
      email: 'old-email',
      apiToken: 'old-token',
      defaultStoryPointsFieldId: 'old-field',
      projectFieldMappings: { OLD: 'customfield_old' },
    });
    (prisma.jiraConfig.update as jest.Mock).mockResolvedValueOnce({ id: 'jira-config' });

    await jiraService.updateFieldMappings({
      baseUrl: 'new-base',
      defaultStoryPointsFieldId: 'new-field',
    });

    expect(prisma.jiraConfig.update).toHaveBeenCalledWith({
      where: { id: 'jira-config' },
      data: {
        baseUrl: 'new-base',
        email: 'old-email',
        apiToken: 'old-token',
        defaultStoryPointsFieldId: 'new-field',
        projectFieldMappings: { OLD: 'customfield_old' },
      },
    });
  });

  it('stops paginated search when max total issues is reached', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
      jiraBaseUrl: 'https://jira.example.com',
      jiraEmail: 'jira@example.com',
      jiraApiTokenEncrypted: 'enc',
    });
    client.get.mockImplementation((_url: string, { params }: any) =>
      Promise.resolve({
        data: {
          total: 2000,
          issues: Array.from({ length: 100 }, (_, index) => ({
            id: `${params.startAt}-${index}`,
            key: `PROJ-${params.startAt + index + 1}`,
            fields: { status: { id: 's1', name: 'To Do' }, customfield_10016: null },
          })),
        },
      }),
    );

    const issues = await jiraService.listIssuesByProjectForUser('u1', 'PROJ');
    expect(issues).toHaveLength(1000);
    expect(client.get).toHaveBeenCalledTimes(10);
  });
});
