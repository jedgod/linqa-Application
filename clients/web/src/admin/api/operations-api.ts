export type OperationsOverview = {
  openCases: number;
  unassignedCases: number;
  resolvedToday: number;
  availableStaff: number;
  busyStaff: number;
  totalStaff: number;
};

export type LiveStaff = {
  id: string;
  userId: string;
  displayName: string;
  staffRole: string;
  teamName: string | null;
  presence: "AVAILABLE" | "BUSY" | "AWAY" | "OFFLINE";
  activeCases: number;
  maxConcurrentCases: number;
  lastSeenAt: string | null;
};

export type OpsCase = {
  id: string;
  caseNumber: number;
  state: "OPEN" | "WAITING_USER" | "WAITING_INTERNAL" | "RESOLVED" | "CLOSED";
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  category: string;
  subject: string;
  updatedAt?: string;
  createdAt?: string;
};

export type MyStaffProfile = {
  id: string;
  userId: string;
  displayName: string;
  staffRole: string;
  teamName: string | null;
  presence: "AVAILABLE" | "BUSY" | "AWAY" | "OFFLINE";
  activeCases: number;
  maxConcurrentCases: number;
  suspended: boolean;
};

export type ClientSummary = {
  id: string;
  status: "ACTIVE" | "SUSPENDED" | "DELETED";
  created_at: string;
  verifiedCountryCode: string | null;
  countryVerificationState: string;
} | null;

export type CaseEvent = {
  id: string;
  actor_type: "USER" | "STAFF" | "SYSTEM";
  actor_id: string | null;
  event_type: string;
  body: string | null;
  private: boolean;
  created_at: string;
};

export type CaseNote = {
  id: string;
  case_id: string;
  author_user_id: string;
  author_display_name: string | null;
  body: string;
  created_at: string;
};

export type SupportMessage = {
  id: string;
  caseId: string;
  clientUserId: string;
  direction: "CLIENT_TO_STAFF" | "STAFF_TO_CLIENT";
  authorUserId: string | null;
  authorName: string;
  body: string;
  deliveryStatus: "PENDING" | "SENT" | "DELIVERED" | "FAILED";
  transportMessageId: string | null;
  createdAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
};

export type Client360Projection = {
  caseId: string;
  caseNumber: number | string;
  userId: string | null;
  identity: null | {
    displayName: string | null;
    maskedEmail: string | null;
    maskedPhone: string | null;
    accountState: string;
    countryCode: string | null;
    emailVerified: boolean | null;
    phoneVerified: boolean | null;
    memberSince: string | null;
  };
  devices: null | {
    trustedDeviceCount: number;
    activeDeviceCount: number;
    lastTrustedDeviceSeenAt: string | null;
    platforms: string[];
  };
  linqaSend: null | {
    enabled: boolean;
    accountState: string | null;
    verificationState: string | null;
    activeHoldCount: number | null;
    lastTransactionAt: string | null;
  };
  vault: null | {
    enabled: boolean;
    planName: string | null;
    usedBytes: number | null;
    quotaBytes: number | null;
    quarantineCount: number | null;
  };
  recovery: null | {
    recoveryEmailConfigured: boolean;
    trustedRecoveryDeviceCount: number | null;
    twoFactorEnabled: boolean | null;
    passkeyCount: number | null;
    lastRecoveryAt: string | null;
  };
  risk: null | {
    level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    score: number | null;
    openRiskCaseCount: number | null;
    safetyRestrictionActive: boolean | null;
    lastReviewedAt: string | null;
  };
  availability: Record<"account" | "devices" | "linqaSend" | "vault" | "recovery" | "risk", boolean>;
};

// One decision vocabulary for all three specialist reviews (recovery, fraud
// & risk, LinqaSend), matching SpecialistDecision on the server.
export type SpecialistDecision = "APPROVED" | "REJECTED" | "ESCALATED";
export type RecoveryDecision = SpecialistDecision;

export type SpecialistReview = {
  id: string;
  decision: "PENDING" | SpecialistDecision;
  reviewerUserId?: string | null;
  specialistNote?: string | null;
  reasonCode?: string | null;
  reviewedAt?: string | null;
};

export type SpecialistDecisionInput = {
  decision: SpecialistDecision;
  specialistNote: string;
  reasonCode: string;
};

export type RecoveryEvidence = {
  caseId: string;
  caseNumber: number | string;
  userId: string | null;
  caseState: string;
  priority: string;
  evidence: {
    recoveryEmails: Array<{ id: string; maskedEmail: string; state: string; verified: boolean; createdAt: string; updatedAt: string }>;
    trustedDevices: Array<{ id: string; label: string; platform: string | null; state: string; trusted: boolean; lastSeenAt: string | null }>;
    passkeys: Array<{ id: string; label: string; createdAt: string; lastUsedAt: string | null; active: boolean }>;
    summary: { verifiedRecoveryEmailCount: number; trustedDeviceCount: number; activePasskeyCount: number };
  };
  review: SpecialistReview | null;
};

export type FraudRiskEvidence = {
  caseId: string;
  caseNumber: number | string;
  userId: string | null;
  caseState: string;
  priority: string;
  evidence: {
    user: { status: string | null; suspended: boolean };
    // score is the worst linqasend_risk_assessments.combined_score across the
    // account's transfers, or null when nothing has been scored.
    risk: { level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; score: number | null };
    safetyReports: Array<{
      id: string;
      category: string;
      severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
      status: string;
      open: boolean;
      createdAt: string;
      updatedAt: string;
    }>;
    paymentMethods: Array<{ id: string; type: string; verificationStatus: string; verified: boolean; createdAt: string }>;
    transfers: Array<{
      id: string;
      publicId: string;
      status: string;
      sendAmountMinor: number;
      sendCurrency: string;
      highValue: boolean;
      createdAt: string;
    }>;
    summary: {
      openSafetyReportCount: number;
      highValueTransferCount: number;
      unverifiedPaymentMethodCount: number;
      userSuspended: boolean;
    };
  };
  review: SpecialistReview | null;
};

export type LinqaSendEvidence = {
  caseId: string;
  caseNumber: number | string;
  userId: string | null;
  caseState: string;
  priority: string;
  evidence: {
    paymentMethods: Array<{
      id: string;
      type: string;
      verificationStatus: string;
      verified: boolean;
      maskedReference: string | null;
      internationalEnabled: boolean;
    }>;
    transfers: Array<{
      id: string;
      publicId: string;
      status: string;
      direction: "SENT" | "RECEIVED";
      sendAmountMinor: number;
      sendCurrency: string;
      receiveAmountMinor: number;
      receiveCurrency: string;
      customerRate: string | null;
      paymentMethodId: string | null;
      paymentMethodVerified: boolean | null;
      failureCode: string | null;
      attention: "NORMAL" | "REVIEW" | "HIGH";
      createdAt: string;
    }>;
    summary: {
      paymentMethodCount: number;
      verifiedPaymentMethodCount: number;
      transferCount: number;
      attentionTransferCount: number;
      failedTransferCount: number;
    };
  };
  review: SpecialistReview | null;
};

export type CaseWorkspace = {
  // Unlike the list endpoints, GET /cases/:caseId returns the
  // support_cases_v2 row as selected (SupportOperationsService.getCaseById
  // aliases nothing), so these fields are snake_case. The type previously
  // spread OpsCase here and claimed a camelCase `caseNumber`, which meant the
  // case workspace header rendered "Case #" with no number.
  case: Pick<OpsCase, "id" | "state" | "priority" | "category" | "subject"> & {
    case_number: number;
    user_id: string | null;
    assigned_staff_id: string | null;
    description: string;
    created_at: string;
    updated_at: string;
  };
  clientSummary: ClientSummary;
  assignedStaff: { id: string; displayName: string; staffRole: string; teamName: string | null; presence: string } | null;
  events: CaseEvent[];
  notes: CaseNote[];
};

export class OperationsApiClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly accessToken: string
  ) {}

  overview() {
    return this.get<OperationsOverview>("/v1/admin/operations/dashboard");
  }

  async liveStaff() {
    const r = await this.get<{ items: LiveStaff[] }>("/v1/admin/operations/staff/live");
    return r.items;
  }

  async myWork() {
    const r = await this.get<{ items: OpsCase[] }>("/v1/admin/operations/staff/my-work");
    return r.items;
  }

  async unassigned(limit = 25) {
    const r = await this.get<{ items: OpsCase[] }>(`/v1/admin/operations/cases/unassigned?limit=${limit}`);
    return r.items;
  }

  me() {
    return this.get<MyStaffProfile>("/v1/admin/operations/staff/me");
  }

  getCase(caseId: string) {
    return this.get<CaseWorkspace>(`/v1/admin/operations/cases/${caseId}`);
  }

  addNote(caseId: string, body: string) {
    return this.post<CaseNote>(`/v1/admin/operations/cases/${caseId}/notes`, { body });
  }

  assign(caseId: string, staffId: string, reasonCode: string) {
    return this.post<OpsCase>(`/v1/admin/operations/cases/${caseId}/assign`, { staffId, reasonCode });
  }

  release(caseId: string, reasonCode: string) {
    return this.post<OpsCase>(`/v1/admin/operations/cases/${caseId}/release`, { reasonCode });
  }

  updateState(caseId: string, state: OpsCase["state"], reasonCode: string) {
    return this.patch<OpsCase>(`/v1/admin/operations/cases/${caseId}/state`, { state, reasonCode });
  }

  updatePriority(caseId: string, priority: OpsCase["priority"], reasonCode: string) {
    return this.patch<OpsCase>(`/v1/admin/operations/cases/${caseId}/priority`, { priority, reasonCode });
  }

  async listMessages(caseId: string) {
    const r = await this.get<{ items: SupportMessage[] }>(`/v1/admin/operations/cases/${caseId}/messages`);
    return r.items;
  }

  reply(caseId: string, body: string) {
    return this.post<SupportMessage>(`/v1/admin/operations/cases/${caseId}/reply`, { body });
  }

  getClient360(caseId: string) {
    return this.get<Client360Projection>(`/v1/admin/operations/cases/${caseId}/client360`);
  }

  getRecoveryEvidence(caseId: string) {
    return this.get<RecoveryEvidence>(`/v1/admin/operations/cases/${caseId}/recovery`);
  }

  submitRecoveryDecision(caseId: string, input: SpecialistDecisionInput) {
    return this.post<SpecialistReview>(`/v1/admin/operations/cases/${caseId}/recovery/decision`, input);
  }

  getFraudRiskEvidence(caseId: string) {
    return this.get<FraudRiskEvidence>(`/v1/admin/operations/cases/${caseId}/risk`);
  }

  submitFraudRiskDecision(caseId: string, input: SpecialistDecisionInput) {
    return this.post<SpecialistReview>(`/v1/admin/operations/cases/${caseId}/risk/decision`, input);
  }

  getLinqaSendEvidence(caseId: string) {
    return this.get<LinqaSendEvidence>(`/v1/admin/operations/cases/${caseId}/linqasend`);
  }

  submitLinqaSendDecision(caseId: string, input: SpecialistDecisionInput) {
    return this.post<SpecialistReview>(`/v1/admin/operations/cases/${caseId}/linqasend/decision`, input);
  }

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      headers: { authorization: `Bearer ${this.accessToken}` }
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error ?? `Request failed: ${response.status}`);
    return payload as T;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.send<T>("POST", path, body);
  }

  private async patch<T>(path: string, body: unknown): Promise<T> {
    return this.send<T>("PATCH", path, body);
  }

  private async send<T>(method: string, path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${this.accessToken}` },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error ?? `Request failed: ${response.status}`);
    return payload as T;
  }
}
