import { secureStorage } from './storage';
import type { OpsVistaUser, PerformanceResponse, ServerSessionResponse } from '../types';

const API_URL = (process.env.EXPO_PUBLIC_OPSVISTA_API_URL
  ?? 'https://restaurant-support.vercel.app').replace(/\/$/, '');
const SESSION_KEY = 'opsvista.api.session';
let sessionToken: string | null = null;

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function saveSessionToken(token: string) {
  sessionToken = token;
  await secureStorage.setItem(SESSION_KEY, token);
}

export async function loadSessionToken() {
  if (sessionToken) return sessionToken;
  sessionToken = await secureStorage.getItem(SESSION_KEY);
  return sessionToken;
}

export async function clearSessionToken() {
  sessionToken = null;
  await secureStorage.removeItem(SESSION_KEY);
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) {
    throw new ApiError(body.error || `OpsVista request failed (${response.status})`, response.status);
  }
  return body;
}

export async function establishServerSession(accessToken: string): Promise<OpsVistaUser> {
  const response = await fetch(`${API_URL}/api/auth/session`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken }),
  });
  const body = await parseResponse<ServerSessionResponse>(response);
  await saveSessionToken(body.token);
  return body.user;
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await loadSessionToken();
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers,
  });
  return parseResponse<T>(response);
}

export function getPerformance(start: string, end: string, location: string) {
  const params = new URLSearchParams({ start, end, location, include_tasks: 'true' });
  return apiRequest<PerformanceResponse>(`/api/operations/performance?${params}`);
}

export async function endServerSession() {
  await fetch(`${API_URL}/api/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => undefined);
  await clearSessionToken();
}
