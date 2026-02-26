export {};

const mountMock = jest.fn();
let appInstance: any;
const useMock = jest.fn(() => appInstance);
const createAppMock = jest.fn((_component?: unknown) => appInstance);
const createPiniaMock = jest.fn(() => ({ pinia: true }));

beforeEach(() => {
  appInstance = { use: useMock, mount: mountMock };
});

jest.mock('vue', () => ({
  createApp: (component: unknown) => createAppMock(component),
}));

jest.mock('pinia', () => ({
  createPinia: () => createPiniaMock(),
}));

jest.mock('../src/router', () => ({
  router: { name: 'router' },
}));

jest.mock('../src/App.vue', () => ({}));
jest.mock('../src/styles.css', () => ({}));

describe('main bootstrap', () => {
  it('creates app, installs pinia/router, and mounts app', () => {
    jest.isolateModules(() => {
      require('../src/main');
    });

    expect(createAppMock).toHaveBeenCalled();
    expect(createPiniaMock).toHaveBeenCalled();
    expect(useMock).toHaveBeenCalledTimes(2);
    expect(mountMock).toHaveBeenCalledWith('#app');
  });
});
