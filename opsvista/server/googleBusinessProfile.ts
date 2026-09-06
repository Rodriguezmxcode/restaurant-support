import { createHash } from 'node:crypto';
import { getGoogleBusinessCredentials, type GoogleBusinessCredentials } from './integrationStore.js';

const ACCOUNT_API = 'https://mybusinessaccountmanagement.googleapis.com/v1';
const BUSINESS_INFO_API = 'https://mybusinessbusinessinformation.googleapis.com/v1';
const REVIEWS_API = 'https://mybusiness.googleapis.com/v4';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const OPSVISTA_LOCATIONS = ['Stamford','Orange','Fairfield','Danbury','Avon','Southington'] as const;

type GoogleAccount = { name: string; accountName?: string; type?: string };
type GoogleLocation = {
  name: string;
  title?: string;
  storeCode?: string;
  storefrontAddress?: { locality?: string; administrativeArea?: string; addressLines?: string[] };
};
type GoogleReview = {
  reviewId?: string;
  reviewer?: { displayName?: string; isAnonymous?: boolean };
  starRating?: string;
  comment?: string;
  createTime?: string;
  updateTime?: string;
  reviewReply?: { comment?: string; updateTime?: string };
};

export type GoogleReviewLocationSummary = {
  location: string;
  googleLocationName?: string;
  googleTitle?: string;
  reviewCount: number;
  averageRating: number | null;
  fiveStarCount: number;
  lowRatingCount: number;
  unansweredCount: number;
  minimumMet: boolean;
  scorePct: number;
  reviews: Array<{
    id: string;
    reviewer: string;
    rating: number;
    comment: string;
    createTime: string;
    answered: boolean;
  }>;
  mappingError?: string;
};

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

function environmentCredentials(): GoogleBusinessCredentials | null {
  const clientId = process.env.GOOGLE_BUSINESS_PROFILE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GOOGLE_BUSINESS_PROFILE_REFRESH_TOKEN?.trim();
  return clientId && clientSecret && refreshToken ? { clientId, clientSecret, refreshToken } : null;
}

async function credentials(organizationId: string) {
  try {
    const stored = await getGoogleBusinessCredentials(organizationId);
    if (stored?.clientId && stored.clientSecret && stored.refreshToken) return stored;
  } catch (error) {
    if (!environmentCredentials()) throw error;
  }
  return environmentCredentials();
}

function normalized(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function starNumber(value?: string) {
  const values: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
  return values[value || ''] || 0;
}

function easternDate(value?: string) {
  if (!value) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value));
  const item = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${item.year}-${item.month}-${item.day}`;
}

async function accessToken(credential: GoogleBusinessCredentials) {
  if (!credential.refreshToken) throw new Error('Google Business Profile authorization is incomplete');
  const cacheKey = createHash('sha256').update(`${credential.clientId}:${credential.refreshToken}`).digest('base64url');
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const body = new URLSearchParams({
    client_id: credential.clientId,
    client_secret: credential.clientSecret,
    refresh_token: credential.refreshToken,
    grant_type: 'refresh_token',
  });
  const response = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const payload = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!response.ok || !payload.access_token) throw new Error(`Google OAuth failed (${response.status}): ${payload.error_description || payload.error || 'access token unavailable'}`);
  const next = { token: payload.access_token, expiresAt: Date.now() + (Number(payload.expires_in) || 3600) * 1000 };
  tokenCache.set(cacheKey, next);
  return next.token;
}

async function googleJson<T>(url: string, credential: GoogleBusinessCredentials, init?: RequestInit): Promise<T> {
  const token = await accessToken(credential);
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Accept', 'application/json');
  if (init?.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(url, { ...init, headers });
  const payload = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(`Google Business Profile API failed (${response.status}): ${payload.error?.message || response.statusText}`);
  return payload;
}

function configuredLocationMap() {
  const raw = process.env.GOOGLE_BUSINESS_PROFILE_LOCATION_MAP_JSON?.trim();
  if (!raw) return {} as Record<string, string>;
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

async function accountName(credential: GoogleBusinessCredentials) {
  const configured = process.env.GOOGLE_BUSINESS_PROFILE_ACCOUNT_ID?.trim();
  if (configured) return configured.startsWith('accounts/') ? configured : `accounts/${configured}`;
  const payload = await googleJson<{ accounts?: GoogleAccount[] }>(`${ACCOUNT_API}/accounts`, credential);
  const account = payload.accounts?.[0];
  if (!account?.name) throw new Error('No Google Business Profile account is available for this Google authorization');
  return account.name;
}

async function listLocations(account: string, credential: GoogleBusinessCredentials) {
  const locations: GoogleLocation[] = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({ readMask: 'name,title,storeCode,storefrontAddress', pageSize: '100' });
    if (pageToken) params.set('pageToken', pageToken);
    const payload = await googleJson<{ locations?: GoogleLocation[]; nextPageToken?: string }>(`${BUSINESS_INFO_API}/${account}/locations?${params}`, credential);
    locations.push(...(payload.locations || []));
    pageToken = payload.nextPageToken || '';
  } while (pageToken);
  return locations;
}

function matchLocation(internalName: string, locations: GoogleLocation[], configured: Record<string, string>) {
  const explicit = configured[internalName];
  if (explicit) return locations.find(location => location.name === explicit) || { name: explicit };
  const needle = normalized(internalName);
  return locations.find(location => {
    const address = location.storefrontAddress;
    const values = [location.title, location.storeCode, address?.locality, ...(address?.addressLines || [])].filter(Boolean).map(value => normalized(String(value)));
    return values.some(value => value === needle || value.includes(needle));
  });
}

async function reviewsForLocation(account: string, locationName: string, start: string, end: string, credential: GoogleBusinessCredentials) {
  const reviews: GoogleReview[] = [];
  const parent = locationName.startsWith('accounts/') ? locationName : `${account}/${locationName}`;
  let pageToken = '';
  let pages = 0;
  do {
    const params = new URLSearchParams({ pageSize: '50', orderBy: 'updateTime desc' });
    if (pageToken) params.set('pageToken', pageToken);
    const payload = await googleJson<{ reviews?: GoogleReview[]; nextPageToken?: string }>(`${REVIEWS_API}/${parent}/reviews?${params}`, credential);
    const page = payload.reviews || [];
    reviews.push(...page.filter(review => {
      const date = easternDate(review.createTime);
      return date >= start && date <= end;
    }));
    pageToken = payload.nextPageToken || '';
    pages += 1;
    if (page.length && page.every(review => easternDate(review.updateTime || review.createTime) < start)) break;
  } while (pageToken && pages < 20);
  return reviews;
}

function summarize(location: string, googleLocation: GoogleLocation | undefined, reviews: GoogleReview[]): GoogleReviewLocationSummary {
  if (!googleLocation) return { location, reviewCount: 0, averageRating: null, fiveStarCount: 0, lowRatingCount: 0, unansweredCount: 0, minimumMet: false, scorePct: 0, reviews: [], mappingError: `No Google Business Profile location matched ${location}` };
  const normalizedReviews = reviews.map(review => ({
    id: review.reviewId || `${review.createTime || 'review'}-${review.reviewer?.displayName || 'anonymous'}`,
    reviewer: review.reviewer?.displayName || 'Google user',
    rating: starNumber(review.starRating),
    comment: review.comment || '',
    createTime: review.createTime || '',
    answered: Boolean(review.reviewReply?.comment),
  })).filter(review => review.rating > 0);
  const reviewCount = normalizedReviews.length;
  const averageRating = reviewCount ? normalizedReviews.reduce((sum, review) => sum + review.rating, 0) / reviewCount : null;
  const minimumMet = reviewCount >= 5;
  // Match the Weekly Bonus formula: only performance above 4.0 earns the
  // quality portion, and five 5-star reviews outrank seven 4.5-star reviews.
  const quality = averageRating === null ? 0 : Math.max(0, Math.min(1, averageRating - 4));
  const volume = Math.min(1, reviewCount / 10);
  const scorePct = minimumMet ? Math.min(100, (quality * 0.8 + volume * 0.2) * 100) : 0;
  return {
    location,
    googleLocationName: googleLocation.name,
    googleTitle: googleLocation.title,
    reviewCount,
    averageRating,
    fiveStarCount: normalizedReviews.filter(review => review.rating === 5).length,
    lowRatingCount: normalizedReviews.filter(review => review.rating <= 2).length,
    unansweredCount: normalizedReviews.filter(review => !review.answered).length,
    minimumMet,
    scorePct,
    reviews: normalizedReviews.sort((a, b) => b.createTime.localeCompare(a.createTime)),
  };
}

export async function googleBusinessProfileConfigured(organizationId = 'org-puerto-vallarta') {
  return Boolean(await credentials(organizationId));
}

export async function getGoogleReviewSummaries(start: string, end: string, scope?: string[], organizationId = 'org-puerto-vallarta') {
  const credential = await credentials(organizationId);
  if (!credential) throw new Error('Google Business Profile credentials are not configured');
  const account = await accountName(credential);
  const googleLocations = await listLocations(account, credential);
  const configured = configuredLocationMap();
  const requested = (scope?.length ? scope : [...OPSVISTA_LOCATIONS]).filter(location => OPSVISTA_LOCATIONS.includes(location as typeof OPSVISTA_LOCATIONS[number]));
  const summaries = await Promise.all(requested.map(async location => {
    const match = matchLocation(location, googleLocations, configured);
    if (!match) return summarize(location, undefined, []);
    return summarize(location, match, await reviewsForLocation(account, match.name, start, end, credential));
  }));
  return { source: 'Google Business Profile', account, start, end, minimumReviews: 5, scoring: { qualityWeight: 80, volumeWeight: 20, volumeTarget: 10 }, locations: summaries };
}
