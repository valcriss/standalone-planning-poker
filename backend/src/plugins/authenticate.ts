import { FastifyInstance } from 'fastify';
import { authService } from '../modules/auth/service.js';

export const registerAuthPlugin = async (app: FastifyInstance) => {
  app.decorateRequest('currentUser', null);

  app.addHook('preHandler', async (request) => {
    const authorization = request.headers.authorization;

    if (!authorization || !authorization.startsWith('Bearer ')) {
      request.currentUser = null;
      return;
    }

    const token = authorization.slice('Bearer '.length);

    try {
      const payload = authService.verifyAccessToken(token);
      const user = await authService.getUserById(payload.sub);
      request.currentUser = user ?? null;
    } catch {
      request.currentUser = null;
    }
  });
};
