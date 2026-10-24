import algosdk from "algosdk";

function requestFor(signedTransactions) {
  // Wallet transactions are still unsigned at this point; an already signed group (or one signed by a LogicSig) has none.
  const anyUnsigned = signedTransactions.some((txn) => !txn.sig && !txn.lsig && !txn.msig);
  return new algosdk.modelsv2.SimulateRequest({
    txnGroups: [new algosdk.modelsv2.SimulateRequestTransactionGroup({
      txns: signedTransactions,
    })],
    allowEmptySignatures: anyUnsigned,
    allowMoreLogging: true,
    allowUnnamedResources: false,
    extraOpcodeBudget: 0,
    // Algod rejects fixSigners unless empty signatures are allowed, so a group that is fully signed must not ask for it.
    fixSigners: anyUnsigned,
    execTraceConfig: new algosdk.modelsv2.SimulateTraceConfig({
      enable: true,
      scratchChange: false,
      stackChange: false,
      stateChange: true,
    }),
  });
}

function validateSimulation(response) {
  const group = response?.txnGroups?.[0];
  if (!group) throw new Error("Algod returned no simulation result");
  if (group.failureMessage || group.failedAt?.length) {
    const path = group.failedAt?.length ? ` at transaction path ${group.failedAt.join(" → ")}` : "";
    throw new Error(`Pre-sign simulation failed${path}: ${group.failureMessage || "unknown failure"}`);
  }
  if (group.unnamedResourcesAccessed) {
    throw new Error("Simulation used unnamed resources; refusing a group that would differ at submission");
  }
  return {
    appBudgetAdded: Number(group.appBudgetAdded ?? 0),
    appBudgetConsumed: Number(group.appBudgetConsumed ?? 0),
    groupFeesPaid: Number(group.groupFeesPaid ?? 0),
    groupUsage: Number(group.groupUsage ?? 0),
    transactionCount: group.txnResults?.length ?? 0,
    trace: group.txnResults ?? [],
  };
}

/** Simulate a group of `{ txn, signers }`; `presigned` maps group index to a blob already signed (for example by a LogicSig). */
export async function simulateSignerGroup(algodClient, signerTransactions, presigned = {}) {
  const unsigned = signerTransactions.map(({ txn }, index) => (
    presigned[index] ? algosdk.decodeSignedTransaction(presigned[index]) : new algosdk.SignedTransaction({ txn })
  ));
  const response = await algodClient.simulateTransactions(requestFor(unsigned)).do();
  return validateSimulation(response);
}

export async function simulateSignedGroup(algodClient, signedBlobs) {
  const signed = signedBlobs.map((blob) => algosdk.decodeSignedTransaction(blob));
  const response = await algodClient.simulateTransactions(requestFor(signed)).do();
  return validateSimulation(response);
}
