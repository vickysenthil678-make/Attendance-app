import axios from 'axios';
import * as storage from './storage';

const configuredServerUrl = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/+$/, '');
const configuredUrl = configuredServerUrl
  ? (/\/api$/i.test(configuredServerUrl) ? configuredServerUrl : `${configuredServerUrl}/api`)
  : undefined;
let sessionExpiredHandler: (() => void) | undefined;

export const api = axios.create({
  baseURL: configuredUrl,
  timeout: 30000,
  headers: { Accept: 'application/json' },
});

api.interceptors.request.use(async (config) => {
  if (!configuredUrl) {
    throw new Error('Set EXPO_PUBLIC_API_URL to the reachable existing backend URL before running the app.');
  }
  const token = await storage.getItemAsync('attendance.jwt');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(undefined, async (error: unknown) => {
  if (axios.isAxiosError(error) && error.response?.status === 401) {
    await storage.deleteItemAsync('attendance.jwt');
    await storage.deleteItemAsync('attendance.user');
    sessionExpiredHandler?.();
  }
  return Promise.reject(error);
});

export function setSessionExpiredHandler(handler?: () => void) {
  sessionExpiredHandler = handler;
}

export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string } | undefined;
    if (data?.message) return data.message;
    if (error.code === 'ECONNABORTED') return 'The server took too long to respond. Try again.';
    if (!error.response) return 'Cannot reach the attendance server. Check the API URL and network connection.';
  }
  return error instanceof Error ? error.message : 'The request could not be completed.';
}

export function hasApiUrl(): boolean {
  return Boolean(configuredUrl);
}
