import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv();

const parseBoolean = z.preprocess((value) => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
      return true;
    }

    if (normalized === 'false' || normalized === '0' || normalized === 'no') {
      return false;
    }
  }

  return value;
}, z.boolean());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3333),
  APP_BASE_URL: z.string().default('http://localhost:5174'),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(7),
  REFRESH_COOKIE_NAME: z.string().default('pp_refresh_token'),
  AUTO_CLOSE_AFTER_MS: z.coerce.number().int().positive().default(300000),
  CLOSING_DURATION_MS: z.coerce.number().int().positive().default(60000),
  JIRA_CREDENTIALS_ENCRYPTION_KEY: z.string().min(16),
  OIDC_ENABLED: parseBoolean.default(false),
  OIDC_ISSUER_URL: z.string().optional(),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),
  OIDC_REDIRECT_URI: z.string().optional(),
  JIRA_DEFAULT_STORY_POINTS_FIELD_ID: z.string().default('customfield_10016'),
});

export const env = schema.parse(process.env);
