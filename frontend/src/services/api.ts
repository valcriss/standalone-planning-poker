import axios from 'axios';
import { useAuthStore } from '../stores/auth';

export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const authStore = useAuthStore();

  if (authStore.accessToken) {
    config.headers.Authorization = `Bearer ${authStore.accessToken}`;
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const authStore = useAuthStore();
    if (error.response?.status === 401 && authStore.accessToken) {
      try {
        await authStore.refresh();
        error.config.headers.Authorization = `Bearer ${authStore.accessToken}`;
        return api.request(error.config);
      } catch {
        await authStore.logout();
      }
    }

    throw error;
  },
);
