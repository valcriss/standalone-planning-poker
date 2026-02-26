describe('realtime helpers', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('throws when io is not initialized', async () => {
    const realtime = await import('../src/realtime.js');
    expect(() => realtime.getIo()).toThrow('SOCKET_IO_NOT_INITIALIZED');
  });

  it('returns the initialized io instance', async () => {
    const realtime = await import('../src/realtime.js');
    const io = { to: jest.fn() };

    realtime.setIo(io as any);

    expect(realtime.getIo()).toBe(io);
  });

  it('builds session room name', async () => {
    const realtime = await import('../src/realtime.js');
    expect(realtime.sessionRoom('abc123')).toBe('session:abc123');
  });
});
