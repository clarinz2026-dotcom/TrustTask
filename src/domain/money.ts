export type Earnings = {
  grossMinor: bigint;
  feeMinor: bigint;
  netMinor: bigint;
};

export function calculateEarnings(
  grossMinor: bigint,
  feeBasisPoints = 1000,
): Earnings {
  if (grossMinor <= 0n) throw new Error("Gross amount must be positive");
  if (
    !Number.isInteger(feeBasisPoints) ||
    feeBasisPoints < 0 ||
    feeBasisPoints > 10_000
  ) {
    throw new Error("Fee basis points must be between 0 and 10000");
  }
  const feeMinor = (grossMinor * BigInt(feeBasisPoints) + 5000n) / 10_000n;
  return { grossMinor, feeMinor, netMinor: grossMinor - feeMinor };
}
