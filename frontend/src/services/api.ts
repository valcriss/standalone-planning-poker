import axios from 'axios';
import { useAuthStore } from '../stores/auth';

const isApiErrorCodeLike = (value: unknown): value is string =>
  typeof value === 'string' && /^JIRA_[A-Z0-9_]+$/.test(value);

export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

export const getApiErrorCode = (error: unknown) => {
  if (axios.isAxiosError(error)) {
    const code = error.response?.data?.error;
    if (typeof code === 'string') {
      return code;
    }

    const message = error.response?.data?.message;
    return isApiErrorCodeLike(message) ? message : '';
  }

  return error instanceof Error ? error.message : '';
};

export const getApiErrorMessage = (error: unknown) => {
  if (axios.isAxiosError(error)) {
    const message = error.response?.data?.message;
    if (typeof message !== 'string' || isApiErrorCodeLike(message)) {
      return '';
    }

    return message;
  }

  return error instanceof Error ? error.message : '';
};

export const getApiErrorDetails = (error: unknown) => {
  if (!axios.isAxiosError(error)) {
    return null;
  }

  const details = error.response?.data?.details;
  return details && typeof details === 'object' ? details as Record<string, unknown> : null;
};

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
