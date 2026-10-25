// Vestige is MainNet only. A launch's Tinyman pool is tradable there as soon as the pool exists.
export function vestigeAssetUrl(assetId) {
  return `https://vestige.fi/asset/${BigInt(assetId)}`;
}