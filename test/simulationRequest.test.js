import assert from "node:assert/strict";
import test from "node:test";
import algosdk from "algosdk";
import { simulateSignedGroup, simulateSignerGroup } from "../src/launchpad/simulation.js";

const account = algosdk.generateAccount();
const params = {
  fee: 1000n, flatFee: true, firstValid: 1n, lastValid: 1000n,
  genesisHash: new Uint8Array(32), genesisID: "test-v1",
};
const payment = () => algosdk.makePaymentTxnWithSuggestedParamsFromObject({
  sender: account.addr, receiver: account.addr, amount: 0n, suggestedParams: params,
});

function capturingAlgod() {
  const seen = {};
  return {
    seen,
    simulateTransactions(request) {
      seen.request = request;
      return { do: async () => ({ txnGroups: [{ txnResults: [{}] }] }) };
    },
  };
}

test("a group with signatures never asks algod to fix signers", async () => {
  const algod = capturingAlgod();
  const signed = algosdk.signTransaction(payment(), account.sk).blob;
  await simulateSignedGroup(algod, [signed]);
  assert.equal(algod.seen.request.allowEmptySignatures, false);
  assert.equal(algod.seen.request.fixSigners, false);
});

test("an unsigned group allows empty signatures and fixes signers together", async () => {
  const algod = capturingAlgod();
  await simulateSignerGroup(algod, [{ txn: payment() }]);
  assert.equal(algod.seen.request.allowEmptySignatures, true);
  assert.equal(algod.seen.request.fixSigners, true);
});
