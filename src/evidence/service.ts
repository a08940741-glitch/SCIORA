import type { Config } from "../config.ts";
import { defaultClientFactory, type ClientFactory } from "../ai/index.ts";
import { NoopRetriever, type SourceRetriever } from "../knowledge/retriever.ts";
import { DEFAULT_RETRIEVAL_TIMEOUT_MS, runRetrieval } from "../knowledge/service.ts";
import { sanitizeSources } from "../knowledge/sources.ts";
import { AnthropicEvidenceProvider, DemoEvidenceProvider, type EvidenceProvider } from "./provider.ts";
import type { AnalyzedSubClaim, EvidenceRequest, EvidenceResponse } from "./schemas.ts";
import { checkEvidence, overallVerdict, subClaimVerdict } from "./verdicts.ts";

/**
 * Evidence Analyzer service: claim → (optional) retrieval → AI analysis → server-side evidence
 * check and verdicts. Reuses the Knowledge Explorer retrieval step and source sanitizing.
 */
export class EvidenceService {
  readonly provider: EvidenceProvider;
  readonly retriever: SourceRetriever;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(opts: { provider: EvidenceProvider; retriever?: SourceRetriever; retrievalTimeoutMs?: number; now?: () => number }) {
    this.provider = opts.provider;
    this.retriever = opts.retriever ?? new NoopRetriever();
    this.timeoutMs = opts.retrievalTimeoutMs ?? DEFAULT_RETRIEVAL_TIMEOUT_MS;
    this.now = opts.now ?? Date.now;
  }

  async analyze(req: EvidenceRequest): Promise<EvidenceResponse> {
    const retrieval = await runRetrieval({
      simulated: this.provider.simulated,
      retriever: this.retriever,
      query: req.claim,
      language: req.language,
      timeoutMs: this.timeoutMs,
      now: this.now,
      prepare: sanitizeSources,
    });
    const { analysis, meta } = await this.provider.analyze({ request: req, sources: retrieval.sources });

    let removedEvidence = 0;
    const subClaims: AnalyzedSubClaim[] = analysis.subClaims.map((s) => {
      const { kept, removed } = checkEvidence(s.evidence, retrieval.sources);
      removedEvidence += removed;
      return {
        id: s.id,
        text: s.text,
        type: s.type,
        verdict: subClaimVerdict(s.type, kept),
        evidence: kept,
        missingEvidence: s.missingEvidence,
        backgroundNote: s.backgroundNote,
      };
    });

    const evidenceItems = subClaims.reduce((n, s) => n + s.evidence.length, 0);
    const caveats = [...analysis.caveats];
    if (removedEvidence > 0) caveats.unshift(`SCIORA حيد ${removedEvidence} ديال الأدلة اللي ما كانتش مقتبسة من مصدر مسترجع.`);

    return {
      understood: analysis.understood,
      overall: { verdict: overallVerdict(subClaims), checkableSubClaims: subClaims.filter((s) => s.verdict !== "not_checkable").length },
      subClaims,
      sources: retrieval.sources,
      basis: {
        kind: evidenceItems > 0 ? "retrieved_sources" : "none",
        retrievalPerformed: retrieval.performed,
        retriever: retrieval.retriever,
        retrievalNote: retrieval.note,
        evidenceItems,
        removedEvidence,
      },
      caveats: caveats.slice(0, 6),
      meta,
    };
  }
}

/** Same demo/live rule as every other SCIORA module. Live evidence uses the REASON model. */
export function createEvidenceProvider(config: Config, clientFactory: ClientFactory = defaultClientFactory): EvidenceProvider {
  if (config.aiMode === "live" && config.anthropicApiKey) {
    return new AnthropicEvidenceProvider({ client: clientFactory(config.anthropicApiKey), model: config.models.reason });
  }
  return new DemoEvidenceProvider();
}
