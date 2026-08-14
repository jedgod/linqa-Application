export interface CompliancePerson {
  legalName: string;
  dateOfBirth?: string;
  country: string;
}

export interface ComplianceProvider {
  readonly name: string;
  screenPerson(input: CompliancePerson): Promise<{ decision: "CLEAR" | "REVIEW" | "BLOCK"; reasons: string[] }>;
}

/**
 * No real sanctions/AML screening provider is configured in this
 * environment. Unlike the object-storage/push fail-closed adapters (which
 * simply refuse the whole operation), a real money transfer must never
 * silently skip screening — but it also must never auto-clear without one.
 * So this provider reports every person as REVIEW rather than throwing:
 * `TransferOrchestratorService` treats REVIEW as "route to manual review",
 * a safe, defined outcome, instead of either faking CLEAR or crashing the
 * request.
 */
export class UnconfiguredComplianceProvider implements ComplianceProvider {
  readonly name = "unconfigured";
  async screenPerson(): Promise<{ decision: "REVIEW"; reasons: string[] }> {
    return { decision: "REVIEW", reasons: ["compliance_provider_not_configured"] };
  }
}

export class ComplianceService {
  constructor(private readonly provider: ComplianceProvider) {}

  async screenTransfer(input: { sender: CompliancePerson; recipient: CompliancePerson }) {
    const [sender, recipient] = await Promise.all([
      this.provider.screenPerson(input.sender),
      this.provider.screenPerson(input.recipient)
    ]);

    if (sender.decision === "BLOCK" || recipient.decision === "BLOCK") {
      return { decision: "BLOCK" as const, reasons: [...sender.reasons, ...recipient.reasons] };
    }
    if (sender.decision === "REVIEW" || recipient.decision === "REVIEW") {
      return { decision: "REVIEW" as const, reasons: [...sender.reasons, ...recipient.reasons] };
    }
    return { decision: "CLEAR" as const, reasons: [] };
  }
}
