// US state tax rates and jurisdiction data.
// Combined state + average local rates, ~2024.
export const JURISDICTION_MAP: Record<
  string,
  { name: string; stateRate: number; avgLocalRate: number; totalRate: number }
> = {
  CA: { name: "California", stateRate: 0.0725, avgLocalRate: 0.0149, totalRate: 0.0874 },
  NY: { name: "New York", stateRate: 0.04, avgLocalRate: 0.0452, totalRate: 0.0852 },
  TX: { name: "Texas", stateRate: 0.0625, avgLocalRate: 0.0196, totalRate: 0.0821 },
  FL: { name: "Florida", stateRate: 0.06, avgLocalRate: 0.0101, totalRate: 0.0701 },
  WA: { name: "Washington", stateRate: 0.065, avgLocalRate: 0.0273, totalRate: 0.0923 },
  IL: { name: "Illinois", stateRate: 0.0625, avgLocalRate: 0.0244, totalRate: 0.0869 },
  PA: { name: "Pennsylvania", stateRate: 0.06, avgLocalRate: 0.0034, totalRate: 0.0634 },
  OH: { name: "Ohio", stateRate: 0.0575, avgLocalRate: 0.014, totalRate: 0.0715 },
  GA: { name: "Georgia", stateRate: 0.04, avgLocalRate: 0.033, totalRate: 0.073 },
  NC: { name: "North Carolina", stateRate: 0.0475, avgLocalRate: 0.0221, totalRate: 0.0696 },
  MI: { name: "Michigan", stateRate: 0.06, avgLocalRate: 0, totalRate: 0.06 },
  NJ: { name: "New Jersey", stateRate: 0.06625, avgLocalRate: 0, totalRate: 0.06625 },
  VA: { name: "Virginia", stateRate: 0.043, avgLocalRate: 0.013, totalRate: 0.056 },
  AZ: { name: "Arizona", stateRate: 0.056, avgLocalRate: 0.028, totalRate: 0.084 },
  MA: { name: "Massachusetts", stateRate: 0.0625, avgLocalRate: 0, totalRate: 0.0625 },
  TN: { name: "Tennessee", stateRate: 0.07, avgLocalRate: 0.0269, totalRate: 0.0969 },
  IN: { name: "Indiana", stateRate: 0.07, avgLocalRate: 0, totalRate: 0.07 },
  MO: { name: "Missouri", stateRate: 0.04225, avgLocalRate: 0.038, totalRate: 0.08025 },
  MD: { name: "Maryland", stateRate: 0.06, avgLocalRate: 0, totalRate: 0.06 },
  CO: { name: "Colorado", stateRate: 0.029, avgLocalRate: 0.048, totalRate: 0.077 },
  OR: { name: "Oregon", stateRate: 0, avgLocalRate: 0, totalRate: 0 },
  MT: { name: "Montana", stateRate: 0, avgLocalRate: 0, totalRate: 0 },
  NH: { name: "New Hampshire", stateRate: 0, avgLocalRate: 0, totalRate: 0 },
  DE: { name: "Delaware", stateRate: 0, avgLocalRate: 0, totalRate: 0 },
};

export function getJurisdiction(stateCode: string | null | undefined) {
  if (!stateCode) return null;
  return JURISDICTION_MAP[stateCode.toUpperCase()] ?? null;
}

export function calculateTax(amountCents: number, stateCode: string | null | undefined): number {
  const jurisdiction = getJurisdiction(stateCode);
  if (!jurisdiction) return 0;
  return Math.round(amountCents * jurisdiction.totalRate);
}

export const NEXUS_THRESHOLDS = {
  revenueCents: 10_000_000, // $100,000
  transactions: 200,
};

export const WARNING_THRESHOLD = 0.8;
