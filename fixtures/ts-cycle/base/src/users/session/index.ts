import { planLimits } from "../../billing/plans.js";

export function currentOrg() {
  return { id: "org_1", plan: "pro", limit: planLimits("pro") };
}
