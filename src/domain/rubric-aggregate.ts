import type { CriterionJudgement, Rubric, Verdict, WrittenJudgement } from "./schemas.ts";
import { normalizeForMatch } from "./normalize.ts";

/**
 * Layer C: the SERVER decides the final verdict from per-criterion judgements.
 * The AI's opinion is an input, not the verdict.
 *
 * 1. Evidence check: a "met"/"partial" judgement must quote text that really appears
 *    in the student's answer (after normalization). Otherwise → "unclear".
 * 2. Rule:
 *    - any required criterion unclear, or AI confidence low  → uncertain
 *    - all required criteria met                              → correct
 *    - all required criteria clearly not_met                  → incorrect
 *    - otherwise                                              → partially_correct
 * "uncertain" never counts against the student's level estimate.
 */

export interface CriterionOutcome {
  id: string;
  description: string;
  required: boolean;
  judgement: CriterionJudgement["judgement"];
  evidence: string | null;
  /** Why an AI judgement was downgraded to unclear, if it was. */
  downgradedReason: string | null;
}

export interface AggregateResult {
  verdict: Verdict;
  score: number | null;
  criteria: CriterionOutcome[];
  misconception: string | null;
  uncertaintyReason: string | null;
  /** Descriptions of required criteria that could not be determined (for localized messages). */
  unclearRequired: string[];
}

const VALUE: Record<CriterionJudgement["judgement"], number> = { met: 1, partial: 0.5, not_met: 0, unclear: 0 };

export function evidenceAppearsInAnswer(evidence: string | null, answer: string): boolean {
  if (!evidence) return false;
  const e = normalizeForMatch(evidence);
  if (e.length === 0) return false;
  return normalizeForMatch(answer).includes(e);
}

export function aggregate(rubric: Rubric, judgement: WrittenJudgement, studentAnswer: string): AggregateResult {
  const byId = new Map(judgement.criteria.map((c) => [c.criterionId, c]));

  const criteria: CriterionOutcome[] = rubric.criteria.map((rc) => {
    const j = byId.get(rc.id);
    if (!j) {
      return { id: rc.id, description: rc.description, required: rc.required, judgement: "unclear", evidence: null, downgradedReason: "not judged" };
    }
    if ((j.judgement === "met" || j.judgement === "partial") && !evidenceAppearsInAnswer(j.evidence, studentAnswer)) {
      return { id: rc.id, description: rc.description, required: rc.required, judgement: "unclear", evidence: null, downgradedReason: "quoted evidence not found in the answer" };
    }
    return { id: rc.id, description: rc.description, required: rc.required, judgement: j.judgement, evidence: j.evidence, downgradedReason: null };
  });

  const required = criteria.some((c) => c.required) ? criteria.filter((c) => c.required) : criteria;
  const misconception =
    judgement.misconceptionId !== null
      ? (rubric.misconceptions.find((m) => m.id === judgement.misconceptionId)?.description ?? null)
      : null;

  const unclearRequired = required.filter((c) => c.judgement === "unclear");
  if (unclearRequired.length > 0 || judgement.confidence === "low") {
    const reason =
      unclearRequired.length > 0
        ? `Could not determine: ${unclearRequired.map((c) => c.description).join("; ")}`
        : "The grader reported low confidence.";
    return { verdict: "uncertain", score: null, criteria, misconception, uncertaintyReason: reason, unclearRequired: unclearRequired.map((c) => c.description) };
  }

  const totalWeight = rubric.criteria.reduce((s, c) => s + c.weight, 0);
  const earned = rubric.criteria.reduce((s, rc, i) => s + rc.weight * VALUE[criteria[i]!.judgement], 0);
  const score = Math.round((earned / totalWeight) * 100) / 100;

  let verdict: Verdict;
  if (required.every((c) => c.judgement === "met")) verdict = "correct";
  else if (required.every((c) => c.judgement === "not_met")) verdict = "incorrect";
  else verdict = "partially_correct";

  return { verdict, score, criteria, misconception, uncertaintyReason: null, unclearRequired: [] };
}
