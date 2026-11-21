export function planLimits(plan: string): number {
  return plan === "pro" ? 100 : 10;
}
