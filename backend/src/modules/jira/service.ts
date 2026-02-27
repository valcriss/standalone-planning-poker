import axios from 'axios';
import { PlanningPokerSession, Prisma } from '@prisma/client';
import { prisma } from '../../prisma.js';
import { env } from '../../config.js';
import { decryptCredential, encryptCredential } from './credentials-crypto.js';

type JiraCredentials = {
  baseUrl: string;
  email: string;
  apiToken: string;
};

const buildClient = (credentials: JiraCredentials) => {
  const auth = Buffer.from(`${credentials.email}:${credentials.apiToken}`).toString('base64');

  return axios.create({
    baseURL: `${credentials.baseUrl.replace(/\/$/, '')}/rest/api/3`,
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
    },
  });
};

const getFieldMappingConfig = async () => {
  const config = await prisma.jiraConfig.findUnique({ where: { id: 'jira-config' } });
  return {
    defaultStoryPointsFieldId: config?.defaultStoryPointsFieldId || env.JIRA_DEFAULT_STORY_POINTS_FIELD_ID,
    projectFieldMappings: (config?.projectFieldMappings ?? {}) as Record<string, string>,
  };
};

const getStoryPointFieldId = async (projectKey: string) => {
  const mappingConfig = await getFieldMappingConfig();
  return (
    mappingConfig.projectFieldMappings[projectKey.toUpperCase()] || mappingConfig.defaultStoryPointsFieldId
  );
};

const extractAtlassianDocText = (value: unknown): string => {
  if (!value || typeof value !== 'object') {
    return '';
  }

  const node = value as {
    type?: string;
    text?: string;
    content?: unknown[];
  };

  if (typeof node.text === 'string') {
    return node.text;
  }

  if (!Array.isArray(node.content)) {
    return '';
  }

  return node.content
    .map((child) => extractAtlassianDocText(child))
    .filter(Boolean)
    .join(node.type === 'paragraph' ? '\n' : ' ')
    .trim();
};

const searchIssuesPaginated = async (
  client: ReturnType<typeof axios.create>,
  jql: string,
  fields: string[],
  maxTotal = 1000,
) => {
  const pageSize = 100;
  let startAt = 0;
  let total = 0;
  const issues: Array<{
    id: string;
    key: string;
    fields?: { summary?: string; status?: { id?: string; name?: string } };
  }> = [];

  do {
    // eslint-disable-next-line no-console
    console.log('[JIRA] search request', { jql, startAt, pageSize, maxTotal });

    const response = await client.get('/search/jql', {
      params: {
        jql,
        startAt,
        maxResults: pageSize,
        fields: fields.join(','),
      },
    });

    const batch = (response.data.issues || []) as Array<{
      id: string;
      key: string;
      fields?: { summary?: string; status?: { id?: string; name?: string } };
    }>;

    total = Number(response.data.total || 0);
    issues.push(...batch);
    startAt += batch.length;

    // eslint-disable-next-line no-console
    console.log('[JIRA] search response', {
      jql,
      received: batch.length,
      accumulated: issues.length,
      total,
      nextStartAt: startAt,
    });

    if (issues.length >= maxTotal) {
      break;
    }
  } while (startAt < total);

  return issues.slice(0, maxTotal);
};

const ensureUserCredentials = async (userId: string): Promise<JiraCredentials> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      jiraBaseUrl: true,
      jiraEmail: true,
      jiraApiTokenEncrypted: true,
    },
  });

  if (!user?.jiraBaseUrl || !user.jiraEmail || !user.jiraApiTokenEncrypted) {
    throw new Error('JIRA_NOT_CONFIGURED');
  }

  return {
    baseUrl: user.jiraBaseUrl,
    email: user.jiraEmail,
    apiToken: decryptCredential(user.jiraApiTokenEncrypted),
  };
};

const ensureSessionCredentials = (session: Pick<
  PlanningPokerSession,
  'jiraBaseUrl' | 'jiraEmail' | 'jiraApiTokenEncrypted'
>): JiraCredentials => ({
  baseUrl: session.jiraBaseUrl,
  email: session.jiraEmail,
  apiToken: decryptCredential(session.jiraApiTokenEncrypted),
});

export const jiraService = {
  async testCredentials(credentials: JiraCredentials) {
    const client = buildClient(credentials);
    await client.get('/myself');
    return true;
  },

  async testUserCredentialsPayload(input: {
    userId?: string;
    baseUrl: string;
    email: string;
    apiToken?: string;
  }) {
    let token = input.apiToken?.trim() ?? '';

    if (!token && input.userId) {
      const user = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { jiraApiTokenEncrypted: true },
      });
      if (user?.jiraApiTokenEncrypted) {
        token = decryptCredential(user.jiraApiTokenEncrypted);
      }
    }

    if (!token) {
      throw new Error('JIRA_NOT_CONFIGURED');
    }

    await this.testCredentials({
      baseUrl: input.baseUrl.trim(),
      email: input.email.trim().toLowerCase(),
      apiToken: token,
    });
    return { ok: true };
  },

  async upsertUserCredentials(
    userId: string,
    input: {
      baseUrl: string;
      email: string;
      apiToken?: string;
    },
  ) {
    const normalizedBaseUrl = input.baseUrl.trim().replace(/\/$/, '');
    const normalizedEmail = input.email.trim().toLowerCase();
    const normalizedToken = input.apiToken?.trim() ?? '';

    let encryptedToken = '';
    if (normalizedToken) {
      encryptedToken = encryptCredential(normalizedToken);
    } else {
      const existing = await prisma.user.findUnique({
        where: { id: userId },
        select: { jiraApiTokenEncrypted: true },
      });
      encryptedToken = existing?.jiraApiTokenEncrypted ?? '';
    }

    if (!normalizedBaseUrl || !normalizedEmail || !encryptedToken) {
      throw new Error('JIRA_NOT_CONFIGURED');
    }

    return prisma.user.update({
      where: { id: userId },
      data: {
        jiraBaseUrl: normalizedBaseUrl,
        jiraEmail: normalizedEmail,
        jiraApiTokenEncrypted: encryptedToken,
      },
    });
  },

  async getUserJiraProfile(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        jiraBaseUrl: true,
        jiraEmail: true,
        jiraApiTokenEncrypted: true,
      },
    });

    return {
      jiraBaseUrl: user?.jiraBaseUrl ?? '',
      jiraEmail: user?.jiraEmail ?? '',
      hasJiraToken: !!user?.jiraApiTokenEncrypted,
      isConfigured: !!user?.jiraBaseUrl && !!user?.jiraEmail && !!user?.jiraApiTokenEncrypted,
    };
  },

  async listProjectsForUser(userId: string) {
    const credentials = await ensureUserCredentials(userId);
    const client = buildClient(credentials);
    const response = await client.get('/project/search?maxResults=200');

    return response.data.values.map((item: { id: string; key: string; name: string }) => ({
      id: item.id,
      key: item.key,
      name: item.name,
    }));
  },

  async listStatusesByProjectForUser(userId: string, projectKey: string) {
    const credentials = await ensureUserCredentials(userId);
    const client = buildClient(credentials);
    const response = await client.get(`/project/${projectKey.toUpperCase()}/statuses`);

    const statusesById = new Map<string, string>();
    (
      response.data as Array<{
        statuses?: Array<{ id?: string; name?: string }>;
      }>
    ).forEach((item) => {
      (item.statuses || []).forEach((status) => {
        if (status.id && status.name) {
          statusesById.set(status.id, status.name);
        }
      });
    });

    const statuses = Array.from(new Set(Array.from(statusesById.values()))).sort((left, right) =>
      left.localeCompare(right),
    );

    // eslint-disable-next-line no-console
    console.log('[JIRA] listStatusesByProject', {
      projectKey: projectKey.toUpperCase(),
      statusCount: statuses.length,
      statuses: statuses.slice(0, 30),
    });

    return statuses;
  },

  async listIssuesByProjectForUser(
    userId: string,
    projectKey: string,
    filters?: {
      statusName?: string;
    },
  ) {
    const credentials = await ensureUserCredentials(userId);
    const client = buildClient(credentials);
    const normalizedProjectKey = projectKey.toUpperCase();
    const storyPointsFieldId = await getStoryPointFieldId(normalizedProjectKey);
    const rawIssues = await searchIssuesPaginated(
      client,
      `project = ${normalizedProjectKey} ORDER BY updated DESC`,
      ['summary', 'issuetype', 'status', storyPointsFieldId],
    );

    const mapped = rawIssues.map((issue) => ({
      id: issue.id,
      key: issue.key,
      summary: issue.fields?.summary ?? issue.key,
      statusId: issue.fields?.status?.id ?? 'unknown',
      statusName: issue.fields?.status?.name ?? 'Unknown',
      browseUrl: `${credentials.baseUrl.replace(/\/$/, '')}/browse/${issue.key}`,
      hasStoryPoints:
        !!issue.fields &&
        issue.fields[storyPointsFieldId as keyof typeof issue.fields] !== null &&
        issue.fields[storyPointsFieldId as keyof typeof issue.fields] !== undefined,
    }));

    const statusNameFilter = filters?.statusName?.trim().toLowerCase();

    // eslint-disable-next-line no-console
    console.log('[JIRA] listIssuesByProject', {
      projectKey: normalizedProjectKey,
      requestedStatusName: filters?.statusName ?? null,
      normalizedRequestedStatusName: statusNameFilter ?? null,
      rawIssueCount: mapped.length,
      sampleStatuses: Array.from(new Set(mapped.map((item) => item.statusName))).slice(0, 20),
    });

    const withoutStoryPoints = mapped.filter((item) => !item.hasStoryPoints);

    if (!statusNameFilter) {
      return withoutStoryPoints;
    }

    const filtered = withoutStoryPoints.filter(
      (item) => item.statusName.trim().toLowerCase() === statusNameFilter,
    );

    // eslint-disable-next-line no-console
    console.log('[JIRA] listIssuesByProject filtered', {
      projectKey: normalizedProjectKey,
      storyPointsFieldId,
      requestedStatusName: filters?.statusName ?? null,
      rawIssueCount: mapped.length,
      withoutStoryPointsCount: withoutStoryPoints.length,
      filteredIssueCount: filtered.length,
      sampleIssueKeys: filtered.slice(0, 20).map((item) => item.key),
    });

    return filtered;
  },

  async getIssueByKeyForUser(userId: string, issueKey: string) {
    const credentials = await ensureUserCredentials(userId);
    const client = buildClient(credentials);
    const response = await client.get(`/issue/${issueKey}?fields=summary,description`);
    const description = extractAtlassianDocText(response.data.fields.description);

    return {
      id: response.data.id,
      key: response.data.key,
      summary: response.data.fields.summary,
      description,
      descriptionAdf: response.data.fields.description ?? null,
      browseUrl: `${credentials.baseUrl.replace(/\/$/, '')}/browse/${response.data.key}`,
    };
  },

  async getIssueByKeyForSession(
    session: Pick<PlanningPokerSession, 'jiraBaseUrl' | 'jiraEmail' | 'jiraApiTokenEncrypted'>,
    issueKey: string,
  ) {
    const credentials = ensureSessionCredentials(session);
    const client = buildClient(credentials);
    const response = await client.get(`/issue/${issueKey}?fields=summary,description`);
    const description = extractAtlassianDocText(response.data.fields.description);

    return {
      id: response.data.id,
      key: response.data.key,
      summary: response.data.fields.summary,
      description,
      descriptionAdf: response.data.fields.description ?? null,
      browseUrl: `${credentials.baseUrl.replace(/\/$/, '')}/browse/${response.data.key}`,
    };
  },

  async assignStoryPointsWithCredentials(
    credentials: JiraCredentials,
    issueKey: string,
    projectKey: string,
    storyPoints: number,
  ) {
    const fieldId = await getStoryPointFieldId(projectKey.toUpperCase());
    const client = buildClient(credentials);

    await client.put(`/issue/${issueKey}`, {
      fields: {
        [fieldId]: storyPoints,
      },
    });
  },

  async assignStoryPointsForSession(
    session: Pick<PlanningPokerSession, 'jiraBaseUrl' | 'jiraEmail' | 'jiraApiTokenEncrypted'>,
    issueKey: string,
    projectKey: string,
    storyPoints: number,
  ) {
    const credentials = ensureSessionCredentials(session);
    await this.assignStoryPointsWithCredentials(credentials, issueKey, projectKey, storyPoints);
  },

  async getConfig() {
    return prisma.jiraConfig.findUnique({ where: { id: 'jira-config' } });
  },

  async updateFieldMappings(payload: {
    baseUrl?: string;
    email?: string;
    apiToken?: string;
    defaultStoryPointsFieldId?: string;
    projectFieldMappings?: Record<string, string>;
  }) {
    const existing = await prisma.jiraConfig.findUnique({ where: { id: 'jira-config' } });

    if (!existing) {
      if (!payload.baseUrl || !payload.email || !payload.apiToken) {
        throw new Error('MISSING_JIRA_BASE_CONFIG');
      }

      return prisma.jiraConfig.create({
        data: {
          id: 'jira-config',
          baseUrl: payload.baseUrl,
          email: payload.email,
          apiToken: payload.apiToken,
          defaultStoryPointsFieldId:
            payload.defaultStoryPointsFieldId ?? env.JIRA_DEFAULT_STORY_POINTS_FIELD_ID,
          projectFieldMappings: payload.projectFieldMappings ?? {},
        },
      });
    }

    return prisma.jiraConfig.update({
      where: { id: 'jira-config' },
      data: {
        baseUrl: payload.baseUrl ?? existing.baseUrl,
        email: payload.email ?? existing.email,
        apiToken: payload.apiToken ?? existing.apiToken,
        defaultStoryPointsFieldId:
          payload.defaultStoryPointsFieldId ?? existing.defaultStoryPointsFieldId,
        projectFieldMappings: payload.projectFieldMappings
          ? (payload.projectFieldMappings as Prisma.InputJsonValue)
          : (existing.projectFieldMappings as Prisma.InputJsonValue),
      },
    });
  },
};
