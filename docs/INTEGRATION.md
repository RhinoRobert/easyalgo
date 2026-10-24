# Profitnet LaunchLab integration

LaunchLab is the Algorand asset-and-liquidity launch workflow inside Profitnet. It is exposed under **AlgoFlow → LaunchLab** and reuses the existing Profitnet shell rather than introducing a second dashboard or standalone product.

## Product boundary

Profitnet is being designed to use Algorand as its durable execution and verification layer. That does not mean the entire application, its models, or private workspace data should be placed on-chain.

- Local/off-chain: AI inference, prompts, private files, source indexing, draft generation, testing, and secret-bearing integrations.
- Algorand/on-chain: application and asset state, wallet-authorized actions, release identifiers, hashes of reviewed build manifests, approval receipts, transaction groups, payments, and settlement.
- Never on-chain or in model context: wallet mnemonics, private keys, Pera sessions, and refresh credentials.

This boundary lets Profitnet become Algorand-native without exposing private operator data or pretending compute-heavy AI workloads belong on-chain.

## Imported foundation

The integration was adapted from the local `pnet/AlgoFlow-PNET-Launchpad-Lab` prototype. The standalone shell was removed. Its reusable Pera wallet, Algorand, Tinyman, resumable-deployment, transaction-simulation, and artifact modules now live under `apps/evidence-agent/frontend/src/launchlab`. The reviewed v2 contract source and generated artifacts live under `apps/evidence-agent/algorand/launchlab_v2`.

The original readiness documents are retained in this directory for provenance. They are references, not proof that a deployment or independent security review has occurred.

## Safe default

LaunchLab defaults to TestNet and remains read-only when required contract values are missing. Configure a reviewed deployment with:

- `VITE_NETWORK=localnet|testnet|mainnet`
- `VITE_LAUNCHPAD_V2_APP_ID`
- `VITE_LAUNCHPAD_V2_PNET_ID`
- `VITE_TINYMAN_SOURCE_POOL`
- LocalNet-only node overrides when applicable: `VITE_LOCALNET_ALGOD`, `VITE_LOCALNET_ALGOD_PORT`, `VITE_LOCALNET_ALGOD_TOKEN`, `VITE_LOCALNET_INDEXER`, `VITE_LOCALNET_INDEXER_PORT`, and `VITE_LOCALNET_INDEXER_TOKEN`

MainNet additionally requires the controlled-canary value declared by `launchpad/config.js`. Do not enable it until the v2 application has been deployed from the reviewed source, the resulting App ID has replaced the placeholder, the exact transaction group has been simulated, and the rollout checklist is signed off.

## Wallet and signing model

Pera Wallet is an external signer. Profitnet prepares and decodes unsigned groups, checks configuration, simulates where supported, and asks Pera to sign the exact reviewed group. Profitnet does not accept or store a mnemonic or private key. A changed group, stale quote, network mismatch, or failed simulation must terminate the signing attempt rather than silently rebuilding a different transaction.

## Operations

The backend feature catalogue now includes `launchlab`. Restart the desktop application after updating so the running backend reloads this permission. A stale backend will correctly show **Access restricted** rather than bypassing authorization.

The initial imported contract and UI remain a foundation, not a production release. Before MainNet use, complete the security review, deploy and verify the v2 contract on TestNet, exercise recovery after interrupted steps, verify Tinyman/ARC-54 dependencies, and record the resulting application and asset identifiers in a reviewed environment configuration.
