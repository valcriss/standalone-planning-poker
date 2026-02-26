import { decryptCredential, encryptCredential } from '../src/modules/jira/credentials-crypto.js';

describe('credentials-crypto', () => {
  it('encrypts and decrypts a credential payload', () => {
    const original = 'jira-api-token-123';
    const encrypted = encryptCredential(original);

    expect(encrypted).not.toBe(original);
    expect(decryptCredential(encrypted)).toBe(original);
  });

  it('throws when payload is malformed', () => {
    expect(() => decryptCredential('invalid')).toThrow('INVALID_ENCRYPTED_CREDENTIAL_PAYLOAD');
  });
});
