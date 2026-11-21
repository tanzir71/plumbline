import assert from "node:assert/strict";
import { test } from "node:test";
import { countInvoices, getInvoice } from "../src/repo/invoices.js";

test("getInvoice stays inside the org", () => {
  assert.equal(getInvoice({ orgId: "a" }, 2), null);
});

test("countInvoices counts one org", () => {
  assert.equal(countInvoices({ orgId: "a" }), 1);
});
