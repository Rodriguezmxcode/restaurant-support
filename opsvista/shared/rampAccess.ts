export function scopeRampTransactionsForLocations<T extends { verifiedRestaurant?: string }>(
  transactions: T[],
  allowedLocations: string[],
  locationScoped = true,
) {
  if (!locationScoped) return transactions;
  const allowed = new Set(allowedLocations.map(location=>location.trim().toLowerCase()).filter(Boolean));
  return transactions.filter(transaction=>Boolean(transaction.verifiedRestaurant)&&allowed.has(String(transaction.verifiedRestaurant).toLowerCase()));
}
