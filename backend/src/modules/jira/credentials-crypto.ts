import crypto from 'node:crypto';
import { env } from '../../config.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

const deriveKey = () => crypto.createHash('sha256').update(env.JIRA_CREDENTIALS_ENCRYPTION_KEY).digest();

export const encryptCredential = (value: string) => {
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('base64')}:${encrypted.toString('base64')}:${authTag.toString('base64')}`;
};

export const decryptCredential = (payload: string) => {
  const [ivPart, encryptedPart, authTagPart] = payload.split(':');
  if (!ivPart || !encryptedPart || !authTagPart) {
    throw new Error('INVALID_ENCRYPTED_CREDENTIAL_PAYLOAD');
  }

  const key = deriveKey();
  const iv = Buffer.from(ivPart, 'base64');
  const encrypted = Buffer.from(encryptedPart, 'base64');
  const authTag = Buffer.from(authTagPart, 'base64');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
};
