import type { TrustStatus } from "./home.types.js";
import { PublisherTrustRepository } from "./publisher-trust.repository.js";

export interface PublisherTrustDecision {
  displayName: string;
  trustStatus: TrustStatus;
  allowBreaking: boolean;
  attributionRequired: boolean;
}

/**
 * Threshold an unlisted publisher must clear on the provider's own confidence
 * score before Home will consider it at all. Deliberately high: the seeded
 * allowlist (migration 041) is the intended path, and an unlisted domain is a
 * domain no one has reviewed.
 */
const UNKNOWN_PUBLISHER_MIN_PROVIDER_SCORE = 0.8;

export class PublisherTrustService {
  constructor(private readonly repo: PublisherTrustRepository) {}

  async requireAllowed(domain: string, providerScore: number): Promise<PublisherTrustDecision> {
    const row = await this.repo.findByDomain(domain);

    if (!row) {
      if (providerScore < UNKNOWN_PUBLISHER_MIN_PROVIDER_SCORE) {
        throw new Error("UNKNOWN_PUBLISHER_SCORE_TOO_LOW");
      }
      // An unreviewed publisher is still attributed and still barred from the
      // BREAKING treatment. Note that UNKNOWN also cannot reach the router's
      // 0.65 validation floor on its own, so this is a second, independent
      // layer rather than the only one.
      return {
        displayName: domain,
        trustStatus: "UNKNOWN",
        allowBreaking: false,
        attributionRequired: true
      };
    }

    if (row.trust_status === "BLOCKED") throw new Error("PUBLISHER_BLOCKED");
    if (!row.allow_external_links) throw new Error("PUBLISHER_LINKS_DISABLED");
    if (providerScore < Number(row.min_provider_score)) throw new Error("PUBLISHER_PROVIDER_SCORE_TOO_LOW");

    return {
      displayName: String(row.display_name),
      trustStatus: row.trust_status as TrustStatus,
      allowBreaking: Boolean(row.allow_breaking),
      // Missing column value defaults to "required": attribution is the safe
      // failure mode for a licensed feed.
      attributionRequired: row.attribution_required !== false
    };
  }
}
