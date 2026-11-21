import { currentOrg } from "../users/session/index.js";

export function planLimits(plan: string): number {
  return plan === "pro" ? 100 : 10;
}

export function currentLimit(): number {
  return currentOrg().limit;
}
