export function calculateWeightedAverage(
  items: { score: number; weight: number }[],
): number | null {
  if (items.length === 0) return null;

  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight === 0) return null;

  const weightedSum = items.reduce(
    (sum, item) => sum + item.score * item.weight,
    0,
  );

  return Math.round((weightedSum / totalWeight) * 100) / 100;
}

export function normalizeScore(score: number, maxScore: number): number {
  if (maxScore === 0) return 0;
  return (score / maxScore) * 100;
}

export function simpleAverage(values: number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return Math.round((sum / values.length) * 100) / 100;
}

export function roundTwo(value: number): number {
  return Math.round(value * 100) / 100;
}
