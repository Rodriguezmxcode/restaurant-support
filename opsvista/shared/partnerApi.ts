export const partnerLocations = [
  { id: 'stamford', name: 'Stamford', kind: 'restaurant' },
  { id: 'orange', name: 'Orange', kind: 'restaurant' },
  { id: 'fairfield', name: 'Fairfield', kind: 'restaurant' },
  { id: 'danbury', name: 'Danbury', kind: 'restaurant' },
  { id: 'avon', name: 'Avon', kind: 'restaurant' },
  { id: 'southington', name: 'Southington', kind: 'restaurant' },
  { id: 'corporate-office', name: 'Corporate Office', kind: 'corporate' },
] as const;
export const partnerScopes = ['locations:read', 'invoices:read'] as const;
export type PartnerKey = { id: string; name: string; prefix: string; createdAt: string; expiresAt: string; revokedAt: string | null; lastUsedAt: string | null };
