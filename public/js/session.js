/**
 * Learning session summary (LEARN → PRACTICE → EVALUATE → IMPROVE).
 * Built ONLY from the real grade results of the current exercise set.
 * "uncertain" results are shown but never drive the recommendation.
 */
export function summarizeSession(results, totalExercises) {
  const list = Array.isArray(results) ? results : [];
  const counts = { correct: 0, partially_correct: 0, incorrect: 0, uncertain: 0 };
  for (const r of list) if (r && counts[r.verdict] !== undefined) counts[r.verdict]++;
  const counted = counts.correct + counts.partially_correct + counts.incorrect;

  const gaps = [];
  const seen = new Set();
  const add = (g) => {
    const k = String(g).trim();
    if (k && !seen.has(k)) {
      seen.add(k);
      gaps.push(k);
    }
  };
  for (const r of list) {
    if (r?.misconception) add(r.misconception);
    for (const c of r?.criteria ?? []) if (c.judgement === "not_met" || c.judgement === "partial") add(c.description);
  }

  let recommendation;
  if (counted > 0 && counts.correct === counted) recommendation = "next_level";
  else if (counted > 0 && counts.incorrect * 2 >= counted) recommendation = "review_first";
  else recommendation = "retry_same";

  return { done: list.length >= totalExercises && totalExercises > 0, counts, counted, gaps: gaps.slice(0, 6), recommendation };
}

const NEXT = { beginner: "school", school: "intermediate", intermediate: "advanced", advanced: "advanced" };
export function nextLevel(level) {
  return NEXT[level] ?? "school";
}
