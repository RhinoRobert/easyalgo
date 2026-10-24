// Updated only after compiling and reviewing contracts/launchpad_v2 artifacts.
// Deployment-package validation compares actual transaction programs to these
// frontend-bundled values instead of trusting hashes inside uploaded JSON.
export const TRUSTED_LAUNCHPAD_BUILD = Object.freeze({
  schemaVersion: 2,
  approvalBytecodeSha256: "49186a301363f46094c222c5414d7ed6eaa22a20c676ee8c514cfe7e01b25c83",
  clearBytecodeSha256: "ed90f0d2da1f1d1abd773c45230651a292a90edbc12a7bf859a493a12a640ce7",
  arc56Sha256: "c50a7fdf717e321e4730d58d6732bbfb8fdf91d67e957dcbfb383a5fd9baf38a",
  sourceSha256: "88cc44621616a22bd0f20dfd08791a33c717db9f4c32895194e8f113b439ad87",
  globalInts: 8,
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
