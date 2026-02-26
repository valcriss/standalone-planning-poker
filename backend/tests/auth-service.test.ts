import crypto from 'node:crypto';
import { authService } from '../src/modules/auth/service.js';
import { prisma } from '../src/prisma.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

jest.mock('../src/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    refreshToken: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

jest.mock('../src/config.js', () => ({
  env: {
    JWT_ACCESS_SECRET: 'test-access-secret-123456',
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_TTL_DAYS: 7,
  },
}));

jest.mock('bcryptjs', () => ({
  __esModule: true,
  default: {
    hash: jest.fn(),
    compare: jest.fn(),
  },
}));

jest.mock('jsonwebtoken', () => ({
  __esModule: true,
  default: {
    sign: jest.fn(),
    verify: jest.fn(),
  },
}));

describe('authService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registers a new user with lowercased email', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(null);
    (bcrypt.hash as jest.Mock).mockResolvedValueOnce('hashed-password');
    (prisma.user.create as jest.Mock).mockResolvedValueOnce({ id: 'u1' });

    await authService.register('USER@EXAMPLE.COM', 'User', 'password123');

    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'user@example.com' } });
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        email: 'user@example.com',
        displayName: 'User',
        passwordHash: 'hashed-password',
      },
    });
  });

  it('throws when registering an existing email', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({ id: 'existing' });
    await expect(authService.register('x@y.com', 'User', 'password123')).rejects.toThrow('EMAIL_ALREADY_EXISTS');
  });

  it('throws INVALID_CREDENTIALS on login when user missing', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(null);
    await expect(authService.login('x@y.com', 'secret')).rejects.toThrow('INVALID_CREDENTIALS');
  });

  it('throws INVALID_CREDENTIALS on login when password mismatch', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({ id: 'u1', passwordHash: 'hash' });
    (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);
    await expect(authService.login('x@y.com', 'secret')).rejects.toThrow('INVALID_CREDENTIALS');
  });

  it('returns user on successful login', async () => {
    const user = { id: 'u1', passwordHash: 'hash' };
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(user);
    (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);

    await expect(authService.login('X@Y.com', 'secret')).resolves.toEqual(user);
  });

  it('signs and verifies access token', () => {
    (jwt.sign as jest.Mock).mockReturnValueOnce('signed-token');
    (jwt.verify as jest.Mock).mockReturnValueOnce({ sub: 'u1', role: 'USER', email: 'a@b.com' });

    const token = authService.signAccessToken({
      id: 'u1',
      role: 'USER',
      email: 'a@b.com',
    } as any);

    expect(token).toBe('signed-token');
    expect(jwt.sign).toHaveBeenCalled();
    expect(authService.verifyAccessToken('signed-token')).toEqual({ sub: 'u1', role: 'USER', email: 'a@b.com' });
  });

  it('issues refresh token and stores hashed value', async () => {
    (prisma.refreshToken.create as jest.Mock).mockResolvedValueOnce({});

    const token = await authService.issueRefreshToken('u1');
    const expectedHash = crypto.createHash('sha256').update(token).digest('hex');

    expect(prisma.refreshToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'u1',
        tokenHash: expectedHash,
        expiresAt: expect.any(Date),
      }),
    });
  });

  it('rotates refresh token and revokes previous one', async () => {
    const oldToken = 'old-token';
    const oldHash = crypto.createHash('sha256').update(oldToken).digest('hex');
    const record = {
      id: 'r1',
      userId: 'u1',
      user: { id: 'u1' },
      expiresAt: new Date(Date.now() + 60_000),
    };

    (prisma.refreshToken.findFirst as jest.Mock).mockResolvedValueOnce(record);
    (prisma.refreshToken.update as jest.Mock).mockResolvedValueOnce({});
    const issueSpy = jest.spyOn(authService, 'issueRefreshToken').mockResolvedValueOnce('next-token');

    const result = await authService.rotateRefreshToken(oldToken);

    expect(prisma.refreshToken.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tokenHash: oldHash }) }),
    );
    expect(prisma.refreshToken.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { revokedAt: expect.any(Date) },
    });
    expect(issueSpy).toHaveBeenCalledWith('u1');
    expect(result).toEqual({ user: { id: 'u1' }, refreshToken: 'next-token' });
  });

  it('throws on rotate when token expired or missing', async () => {
    (prisma.refreshToken.findFirst as jest.Mock).mockResolvedValueOnce(null);
    await expect(authService.rotateRefreshToken('x')).rejects.toThrow('INVALID_REFRESH_TOKEN');
  });

  it('revokes refresh token', async () => {
    (prisma.refreshToken.updateMany as jest.Mock).mockResolvedValueOnce({});
    await authService.revokeRefreshToken('tok');

    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ revokedAt: null }),
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('delegates user retrieval and profile updates to prisma', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({ id: 'u1' });
    (prisma.user.update as jest.Mock).mockResolvedValue({});

    await authService.getUserById('u1');
    await authService.updateAvatar('u1', 'data:image/png;base64,abc');
    await authService.updateDisplayName('u1', 'New Name');

    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'u1' } });
    expect(prisma.user.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'u1' },
      data: { avatarDataUrl: 'data:image/png;base64,abc' },
    });
    expect(prisma.user.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'u1' },
      data: { displayName: 'New Name' },
    });
  });
});
