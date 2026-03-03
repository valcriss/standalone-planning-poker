const requiredEnv = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/planning_poker',
  JWT_ACCESS_SECRET: 'test-access-secret-123456',
  JWT_REFRESH_SECRET: 'test-refresh-secret-123456',
  JIRA_CREDENTIALS_ENCRYPTION_KEY: 'test-encryption-key-123456',
};

const loadConfigWithEnv = async (overrides: Record<string, string | undefined>) => {
  const originalEnv = process.env;
  process.env = {
    ...originalEnv,
    ...requiredEnv,
    ...overrides,
  };
  jest.resetModules();
  const module = await import('../src/config.js');
  process.env = originalEnv;
  return module.env;
};

describe('config env parsing', () => {
  it('parses oidc boolean true variants', async () => {
    const envTrue = await loadConfigWithEnv({ OIDC_ENABLED: 'true' });
    const envYes = await loadConfigWithEnv({ OIDC_ENABLED: 'yes' });
    const envOne = await loadConfigWithEnv({ OIDC_ENABLED: '1' });
    const transparentFalse = await loadConfigWithEnv({ OIDC_TRANSPARENT_LOGIN: 'false' });

    expect(envTrue.OIDC_ENABLED).toBe(true);
    expect(envYes.OIDC_ENABLED).toBe(true);
    expect(envOne.OIDC_ENABLED).toBe(true);
    expect(transparentFalse.OIDC_TRANSPARENT_LOGIN).toBe(false);
  });

  it('parses oidc boolean false variants', async () => {
    const envFalse = await loadConfigWithEnv({ OIDC_ENABLED: 'false' });
    const envNo = await loadConfigWithEnv({ OIDC_ENABLED: 'no' });
    const envZero = await loadConfigWithEnv({ OIDC_ENABLED: '0' });

    expect(envFalse.OIDC_ENABLED).toBe(false);
    expect(envNo.OIDC_ENABLED).toBe(false);
    expect(envZero.OIDC_ENABLED).toBe(false);
  });

  it('applies defaults for optional values', async () => {
    const env = await loadConfigWithEnv({
      OIDC_ENABLED: undefined,
      OIDC_TRANSPARENT_LOGIN: undefined,
      PORT: undefined,
      APP_BASE_URL: undefined,
      JWT_ACCESS_TTL: undefined,
      JWT_REFRESH_TTL_DAYS: undefined,
      REFRESH_COOKIE_NAME: undefined,
      AUTO_CLOSE_AFTER_MS: undefined,
      CLOSING_DURATION_MS: undefined,
      JIRA_DEFAULT_STORY_POINTS_FIELD_ID: undefined,
    });

    expect(env.PORT).toBe(3333);
    expect(env.APP_BASE_URL).toBe('http://localhost:5174');
    expect(env.JWT_ACCESS_TTL).toBe('15m');
    expect(env.JWT_REFRESH_TTL_DAYS).toBe(7);
    expect(env.REFRESH_COOKIE_NAME).toBe('pp_refresh_token');
    expect(env.AUTO_CLOSE_AFTER_MS).toBe(300000);
    expect(env.CLOSING_DURATION_MS).toBe(60000);
    expect(env.JIRA_DEFAULT_STORY_POINTS_FIELD_ID).toBe('customfield_10016');
    expect(env.OIDC_ENABLED).toBe(false);
    expect(env.OIDC_TRANSPARENT_LOGIN).toBe(true);
  });
});
