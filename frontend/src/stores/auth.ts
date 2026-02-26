import { defineStore } from 'pinia';
import { api } from '../services/api';

type User = {
  id: string;
  email: string;
  displayName: string;
  role: 'ADMIN' | 'USER';
  avatarDataUrl: string | null;
  hasJiraCredentials: boolean;
};

export const useAuthStore = defineStore('auth', {
  state: () => ({
    accessToken: '' as string,
    user: null as User | null,
    bootstrapped: false,
  }),
  getters: {
    isAuthenticated: (state) => !!state.accessToken && !!state.user,
  },
  actions: {
    async bootstrap() {
      if (this.bootstrapped) {
        return;
      }

      try {
        await this.refresh();
      } catch {
        this.accessToken = '';
        this.user = null;
      } finally {
        this.bootstrapped = true;
      }
    },

    async register(payload: { email: string; displayName: string; password: string }) {
      const { data } = await api.post('/auth/register', payload);
      this.accessToken = data.accessToken;
      this.user = data.user;
    },

    async login(payload: { email: string; password: string }) {
      const { data } = await api.post('/auth/login', payload);
      this.accessToken = data.accessToken;
      this.user = data.user;
    },

    async refresh() {
      const { data } = await api.post('/auth/refresh');
      this.accessToken = data.accessToken;
      this.user = data.user;
    },

    async logout() {
      this.accessToken = '';
      this.user = null;
      await api.post('/auth/logout');
    },

    setUser(user: User | null) {
      this.user = user;
    },
  },
});
