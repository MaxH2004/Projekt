/**
 * Verteilt einen Betrag in Cent exakt auf Anteile.
 *
 * Verfahren: größter Rest (Hare/Niemeyer). Jeder Anteil erhält zuerst den
 * abgerundeten Betrag, die verbleibenden Cents gehen an die Anteile mit dem
 * größten Rest, bei Gleichstand an den früheren Eintrag. Die Summe der
 * Ergebnisse ist immer gleich dem Gesamtbetrag.
 *
 * Gewichte sind Ganzzahlen (z. B. Fläche in Hundertstel-m², Tage, Personen),
 * damit keine Gleitkommafehler entstehen.
 */
export function allocate(totalCents: bigint, weights: readonly bigint[]): bigint[] {
  if (weights.length === 0) throw new RangeError("Mindestens ein Gewicht erforderlich");
  let weightSum = 0n;
  for (const w of weights) {
    if (w < 0n) throw new RangeError("Gewichte dürfen nicht negativ sein");
    weightSum += w;
  }
  if (weightSum === 0n) throw new RangeError("Summe der Gewichte muss größer als 0 sein");

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
