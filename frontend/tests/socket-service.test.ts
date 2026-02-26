export {};

const ioMock = jest.fn((_url?: string, _options?: unknown) => ({ connected: true }));

jest.mock('socket.io-client', () => ({
  io: (url: string, options: unknown) => ioMock(url, options),
}));

describe('socket service', () => {
  it('creates socket with expected options', async () => {
    let socketModule: any;
    jest.isolateModules(() => {
      socketModule = require('../src/services/socket');
    });

    expect(ioMock).toHaveBeenCalledWith('/', {
      autoConnect: true,
      withCredentials: true,
    });
    expect(socketModule.socket).toEqual({ connected: true });
  });
});
