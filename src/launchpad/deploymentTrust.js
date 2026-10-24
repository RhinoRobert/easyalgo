// Updated only after compiling and reviewing contracts/launchpad_v3 artifacts (a test compares these with the build manifest).
// Deployment-package validation compares actual transaction programs to these
// frontend-bundled values instead of trusting hashes inside uploaded JSON.
export const TRUSTED_LAUNCHPAD_BUILD = Object.freeze({
  schemaVersion: 3,
  approvalBytecodeSha256: "23fc93380267d6421d21d00ca4d6203eab6d8d4086983b6ba4e28554121ae500",
  clearBytecodeSha256: "ed90f0d2da1f1d1abd773c45230651a292a90edbc12a7bf859a493a12a640ce7",
  arc56Sha256: "39eed701f293f31f8a8bc381e11c4eb7aec13bbd878a5b4e64a17a4c43fd7223",
  sourceSha256: "3e7d24037407b16fb44904704db8311faa264a0038b362b45e53564461f58bcb",
  globalInts: 9,
  globalBytes: 2,
  localInts: 0,
  localBytes: 0,
  extraPages: 2,
});
export const NETWORK_GENESIS = Object.freeze({
  testnet: {
    id: "testnet-v1.0",
    hash: "SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=",
  },
  mainnet: {
    id: "mainnet-v1.0",
    hash: "wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=",
  },
});
