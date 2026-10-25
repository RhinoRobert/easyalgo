// Vestige is MainNet only. A launch's Tinyman pool is tradable there as soon as the pool exists.
export function vestigeAssetUrl(assetId) {
  return `https://vestige.fi/asset/${BigInt(assetId)}`;
}

// Where a Vestige metadata manager (the launcher, after launch) sets the token's icon, description and social fields.
export function vestigeManagerUrl(assetId) {
  return `https://vestige.fi/asset-manager/${BigInt(assetId)}`;
}