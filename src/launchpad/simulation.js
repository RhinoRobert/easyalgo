import algosdk from "algosdk";

function requestFor(signedTransactions) {
  const unsignedGroup = signedTransactions.every((txn) => !txn.sig && !txn.lsig && !txn.msig);
  return new algosdk.modelsv2.SimulateRequest({
    txnGroups: [new algosdk.modelsv2.SimulateRequestTransactionGroup({
      txns: signedTransactions,
    })],
    allowEmptySignatures: unsignedGroup,
    allowMoreLogging: true,
    allowUnnamedResources: false,
    extraOpcodeBudget: 0,
    // Algod rejects fixSigners unless empty signatures are allowed, so a group that is already signed must not ask for it.
    fixSigners: unsignedGroup,
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

export async function simulateSignerGroup(algodClient, signerTransactions) {
  const unsigned = signerTransactions.map(({ txn }) => new algosdk.SignedTransaction({ txn }));
  const response = await algodClient.simulateTransactions(requestFor(unsigned)).do();
  return validateSimulation(response);
}

export async function simulateSignedGroup(algodClient, signedBlobs) {
  const signed = signedBlobs.map((blob) => algosdk.decodeSignedTransaction(blob));
  const response = await algodClient.simulateTransactions(requestFor(signed)).do();
  return validateSimulation(response);
}
