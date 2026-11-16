/**
 * Splits an amount in cents exactly across shares.
 *
 * Method: largest remainder (Hare/Niemeyer). Each share first gets its
 * rounded-down amount; the remaining cents go to the shares with the largest
 * remainder, ties go to the earlier entry. The results always sum to the total.
 *
 * Weights are integers (e.g. area in hundredths of a square metre, days,
 * persons) so that no floating-point errors can occur.
 */
export function allocate(totalCents: bigint, weights: readonly bigint[]): bigint[] {
  if (weights.length === 0) throw new RangeError("At least one weight is required");
  let weightSum = 0n;
  for (const w of weights) {
    if (w < 0n) throw new RangeError("Weights must not be negative");
    weightSum += w;
  }
  if (weightSum === 0n) throw new RangeError("Sum of weights must be greater than 0");

  const sign = totalCents < 0n ? -1n : 1n;
  const abs = totalCents * sign;

  const shares = weights.map((w) => (abs * w) / weightSum);
  const remainders = weights.map((w) => (abs * w) % weightSum);
  let leftover = abs - shares.reduce((a, b) => a + b, 0n);

  const order = weights
    .map((_, i) => i)
    .sort((a, b) => {
      const ra = remainders[a]!;
      const rb = remainders[b]!;
      return ra === rb ? a - b : ra > rb ? -1 : 1;
    });
  for (const i of order) {
    if (leftover === 0n) break;
    shares[i] = shares[i]! + 1n;
    leftover -= 1n;
  }
  return shares.map((s) => s * sign);
}
