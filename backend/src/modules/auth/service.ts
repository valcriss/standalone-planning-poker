import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { User, UserRole } from '@prisma/client';
import { env } from '../../config.js';
import { prisma } from '../../prisma.js';

type AccessTokenPayload = {
  sub: string;
  role: UserRole;
  email: string;
};

const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

export const authService = {
  async register(email: string, displayName: string, password: string) {
    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

    if (existing) {
      throw new Error('EMAIL_ALREADY_EXISTS');
    }

    const passwordHash = await bcrypt.hash(password, 10);

    return prisma.user.create({
      data: {
        email: email.toLowerCase(),
        displayName,
        passwordHash,
      },
    });
  },

  async login(email: string, password: string) {
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

    if (!user || !user.passwordHash) {
      throw new Error('INVALID_CREDENTIALS');
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);

    if (!isValid) {
      throw new Error('INVALID_CREDENTIALS');
    }

    return user;
  },

  signAccessToken(user: User) {
    const payload: AccessTokenPayload = {
      sub: user.id,
      role: user.role,
      email: user.email,
    };

    return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
      expiresIn: env.JWT_ACCESS_TTL as jwt.SignOptions['expiresIn'],
    });
  },

  async issueRefreshToken(userId: string) {
    const token = crypto.randomBytes(48).toString('base64url');
    const expiresAt = new Date();

    expiresAt.setDate(expiresAt.getDate() + env.JWT_REFRESH_TTL_DAYS);

    await prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        expiresAt,
      },
    });

    return token;
  },

  async rotateRefreshToken(rawToken: string) {
    const tokenHash = hashToken(rawToken);
    const record = await prisma.refreshToken.findFirst({
      where: {
        tokenHash,
        revokedAt: null,
      },
      include: {
        user: true,
      },
    });

    if (!record || record.expiresAt <= new Date()) {
      throw new Error('INVALID_REFRESH_TOKEN');
    }

    await prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });

    const newToken = await this.issueRefreshToken(record.userId);

    return {
      user: record.user,
      refreshToken: newToken,
    };
  },

  async revokeRefreshToken(rawToken: string) {
    const tokenHash = hashToken(rawToken);
    await prisma.refreshToken.updateMany({
      where: {
        tokenHash,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  },

  verifyAccessToken(token: string): AccessTokenPayload {
    return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
  },

  async getUserById(userId: string) {
    return prisma.user.findUnique({ where: { id: userId } });
  },

  async updateAvatar(userId: string, avatarDataUrl: string | null) {
    return prisma.user.update({
      where: { id: userId },
      data: { avatarDataUrl },
    });
  },

  async updateDisplayName(userId: string, displayName: string) {
    return prisma.user.update({
      where: { id: userId },
      data: { displayName },
    });
  },
};
