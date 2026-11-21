import { rows } from "../store/rows.js";

export function getInvoice(ctx, id) {
  return rows.find((r) => r.org_id === ctx.orgId && r.id === id) ?? null;
}

export function countInvoices(ctx) {
  return rows.filter((r) => r.org_id === ctx.orgId).length;
}

export function listAll(_ctx) {
  return [...rows];
}
