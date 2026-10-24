import test from "node:test";
import assert from "node:assert/strict";
import algosdk from "algosdk";
import { simulateSignerGroup } from "../src/launchpad/simulation.js";

function unsignedPayment() {
  const sender = algosdk.generateAccount().addr.toString();
  const receiver = algosdk.generateAccount().addr.toString();
  return algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender,
    receiver,
    amount: 1n,
    suggestedParams: {
      fee: 1_000n,
      minFee: 1_000n,
      flatFee: true,
      firstValid: 1n,
      lastValid: 1_001n,
      genesisID: "testnet-v1.0",
      genesisHash: new Uint8Array(32),
    },
  });
}

test("pre-sign simulation requires named resources and execution traces", async () => {
  let captured;
  const algod = {
    simulateTransactions: (request) => ({ do: async () => {
      captured = request;
      return { txnGroups: [{
        txnResults: [{}],
        appBudgetConsumed: 77,
        groupFeesPaid: 1_000,
      }] };
    } }),
  };
  const result = await simulateSignerGroup(algod, [{ txn: unsignedPayment(), signers: [] }]);
  assert.equal(captured.allowEmptySignatures, true);
  assert.equal(captured.allowUnnamedResources, false);
  assert.equal(captured.execTraceConfig.enable, true);
  assert.equal(result.appBudgetConsumed, 77);
  assert.equal(result.transactionCount, 1);
});

test("failed simulation prevents signing", async () => {
  const algod = {
    simulateTransactions: () => ({ do: async () => ({
      txnGroups: [{ txnResults: [{}], failedAt: [0, 2], failureMessage: "assert failed" }],
    }) }),
  };
  await assert.rejects(
    simulateSignerGroup(algod, [{ txn: unsignedPayment(), signers: [] }]),
    /transaction path 0 → 2: assert failed/,
  );
});
