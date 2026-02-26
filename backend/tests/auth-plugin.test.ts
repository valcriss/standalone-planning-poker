import { registerAuthPlugin } from '../src/plugins/authenticate.js';
import { authService } from '../src/modules/auth/service.js';

jest.mock('../src/modules/auth/service.js', () => ({
  authService: {
    verifyAccessToken: jest.fn(),
    getUserById: jest.fn(),
  },
}));

describe('registerAuthPlugin', () => {
  it('sets currentUser to null when authorization header is missing', async () => {
    const hooks: Record<string, (request: any) => Promise<void>> = {};
    const app = {
      decorateRequest: jest.fn(),
      addHook: jest.fn((name: string, handler: (request: any) => Promise<void>) => {
        hooks[name] = handler;
      }),
    };

    await registerAuthPlugin(app as any);

    const request = { headers: {}, currentUser: undefined };
    await hooks.preHandler(request);

    expect(app.decorateRequest).toHaveBeenCalledWith('currentUser', null);
    expect(request.currentUser).toBeNull();
    expect(authService.verifyAccessToken).not.toHaveBeenCalled();
  });

  it('sets currentUser when token is valid and user exists', async () => {
    const hooks: Record<string, (request: any) => Promise<void>> = {};
    const app = {
      decorateRequest: jest.fn(),
      addHook: jest.fn((name: string, handler: (request: any) => Promise<void>) => {
        hooks[name] = handler;
      }),
    };

    (authService.verifyAccessToken as jest.Mock).mockReturnValueOnce({ sub: 'user-1' });
    (authService.getUserById as jest.Mock).mockResolvedValueOnce({ id: 'user-1' });

    await registerAuthPlugin(app as any);

    const request = { headers: { authorization: 'Bearer token-123' }, currentUser: null };
    await hooks.preHandler(request);

    expect(authService.verifyAccessToken).toHaveBeenCalledWith('token-123');
    expect(authService.getUserById).toHaveBeenCalledWith('user-1');
    expect(request.currentUser).toEqual({ id: 'user-1' });
  });

  it('sets currentUser to null when token verification fails', async () => {
    const hooks: Record<string, (request: any) => Promise<void>> = {};
    const app = {
      decorateRequest: jest.fn(),
      addHook: jest.fn((name: string, handler: (request: any) => Promise<void>) => {
        hooks[name] = handler;
      }),
    };

    (authService.verifyAccessToken as jest.Mock).mockImplementationOnce(() => {
      throw new Error('bad token');
    });

    await registerAuthPlugin(app as any);

    const request = { headers: { authorization: 'Bearer bad-token' }, currentUser: { id: 'old' } };
    await hooks.preHandler(request);

    expect(request.currentUser).toBeNull();
  });

  it('sets currentUser to null when token is valid but user no longer exists', async () => {
    const hooks: Record<string, (request: any) => Promise<void>> = {};
    const app = {
      decorateRequest: jest.fn(),
      addHook: jest.fn((name: string, handler: (request: any) => Promise<void>) => {
        hooks[name] = handler;
      }),
    };

    (authService.verifyAccessToken as jest.Mock).mockReturnValueOnce({ sub: 'missing-user' });
    (authService.getUserById as jest.Mock).mockResolvedValueOnce(null);

    await registerAuthPlugin(app as any);

    const request = { headers: { authorization: 'Bearer token-123' }, currentUser: { id: 'old' } };
    await hooks.preHandler(request);

    expect(authService.verifyAccessToken).toHaveBeenCalledWith('token-123');
    expect(request.currentUser).toBeNull();
  });
});
