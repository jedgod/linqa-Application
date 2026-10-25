/**
 * Client for the Communities REST API (`server/src/routes/communities.ts`, mounted at `/api/communities`).
 *
 * It signs requests with the access token from Linqa's existing session (the same one every other service uses); it holds no
 * credentials of its own. Which controls a screen shows comes from `myRole`, but that is convenience only: the server
 * re-checks membership and role on every call and answers 403/404 regardless of what the UI offered.
 */

export type CommunityVisibility = "PUBLIC" | "PRIVATE" | "INVITE_ONLY";
export type CommunityRole = "OWNER" | "ADMIN" | "MODERATOR" | "MEMBER";

export type CommunitySummary = {
  id: string;
  name: string;
  description: string;
  category: string;
  visibility: CommunityVisibility;
  country_code: string | null;
  created_at: string;
  member_count: number;
  my_role: CommunityRole | null;
  my_request_status: "PENDING" | "APPROVED" | "REJECTED" | null;
};

export type CommunityDetail = Omit<CommunitySummary, "my_request_status"> & { rules: string };
export type CommunityMember = { user_id: string; role: CommunityRole; joined_at: string };
export type JoinRequest = { id: string; user_id: string; status: "PENDING"; created_at: string };
export type CommunityInvite = { id: string; created_by: string; expires_at: string; max_uses: number; uses: number; revoked_at: string | null; created_at: string };
export type CreatedInvite = { id: string; token: string; expiresAt: string; maxUses: number };
export type Announcement = { id: string; author_id: string; body: string; pinned: boolean; created_at: string };

export type CommunityErrorCode =
  | "unauthorized" | "forbidden" | "not_found" | "invalid_request" | "membership_denied" | "invite_required"
  | "owner_cannot_leave" | "request_not_pending" | "limit_reached" | "rate_limited" | "network" | "unknown";

export class CommunityApiError extends Error {
  constructor(readonly code: CommunityErrorCode, readonly status: number) {
    super(code);
  }
}

export type CommunityListQuery = {
  q?: string;
  category?: string;
  /** ISO 3166-1 alpha-2, upper case. */
  country?: string;
  mine?: boolean;
  limit?: number;
  offset?: number;
};

export type CreateCommunityInput = {
  name: string;
  description?: string;
  category?: string;
  visibility?: CommunityVisibility;
  countryCode?: string | null;
  rules?: string;
};

const KNOWN: ReadonlySet<string> = new Set([
  "unauthorized", "forbidden", "not_found", "invalid_request", "membership_denied", "invite_required",
  "owner_cannot_leave", "request_not_pending", "limit_reached"
]);

export function createCommunityApi(
  apiBaseUrl: string,
  getAccessToken: () => Promise<string | null | undefined>,
  fetchImpl: typeof fetch = fetch
) {
  const base = `${apiBaseUrl.replace(/\/+$/, "")}/api/communities`;
  const seg = (value: string) => encodeURIComponent(value);

  async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const token = await getAccessToken();
    if (!token) throw new CommunityApiError("unauthorized", 401);

    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method: init.method ?? "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          // Fastify rejects a JSON content type with an empty body, so it is only sent when there is one.
          ...(init.body === undefined ? {} : { "Content-Type": "application/json" })
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) })
      });
    } catch {
      throw new CommunityApiError("network", 0);
    }

    if (response.status === 204) return undefined as T;
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      const code: CommunityErrorCode = response.status === 429 ? "rate_limited" : KNOWN.has(data?.error ?? "") ? (data!.error as CommunityErrorCode) : "unknown";
      throw new CommunityApiError(code, response.status);
    }
    return data as T;
  }

  const query = (params: Record<string, string | number | boolean | undefined>) => {
    const parts = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${seg(k)}=${seg(String(v))}`);
    return parts.length ? `?${parts.join("&")}` : "";
  };

  return {
    list: (q: CommunityListQuery = {}) =>
      request<{ communities: CommunitySummary[] }>(`/${query({ ...q })}`),
    mine: (q: Pick<CommunityListQuery, "limit" | "offset"> = {}) =>
      request<{ communities: CommunitySummary[] }>(`/${query({ ...q, mine: true })}`),
    get: (id: string) => request<{ community: CommunityDetail }>(`/${seg(id)}`),
    create: (input: CreateCommunityInput) =>
      request<{ community: CommunityDetail }>("/", { method: "POST", body: input }),

    join: (id: string) => request<{ status: "joined" | "pending" }>(`/${seg(id)}/join`, { method: "POST" }),
    leave: (id: string) => request<void>(`/${seg(id)}/leave`, { method: "POST" }),

    members: (id: string, page: { limit?: number; offset?: number } = {}) =>
      request<{ members: CommunityMember[] }>(`/${seg(id)}/members${query(page)}`),
    changeRole: (id: string, userId: string, role: Exclude<CommunityRole, "OWNER">) =>
      request<{ userId: string; role: CommunityRole }>(`/${seg(id)}/members/${seg(userId)}/role`, { method: "PATCH", body: { role } }),
    removeMember: (id: string, userId: string) =>
      request<void>(`/${seg(id)}/members/${seg(userId)}/remove`, { method: "POST" }),
    banMember: (id: string, userId: string) =>
      request<void>(`/${seg(id)}/members/${seg(userId)}/ban`, { method: "POST" }),

    joinRequests: (id: string) => request<{ requests: JoinRequest[] }>(`/${seg(id)}/requests`),
    approveRequest: (id: string, requestId: string) =>
      request<{ status: "approved" }>(`/${seg(id)}/requests/${seg(requestId)}/approve`, { method: "POST" }),
    rejectRequest: (id: string, requestId: string) =>
      request<{ status: "rejected" }>(`/${seg(id)}/requests/${seg(requestId)}/reject`, { method: "POST" }),

    invites: (id: string) => request<{ invites: CommunityInvite[] }>(`/${seg(id)}/invites`),
    createInvite: (id: string, input: { expiresInHours?: number; maxUses?: number } = {}) =>
      request<{ invite: CreatedInvite }>(`/${seg(id)}/invites`, { method: "POST", body: input }),
    revokeInvite: (id: string, inviteId: string) =>
      request<void>(`/${seg(id)}/invites/${seg(inviteId)}`, { method: "DELETE" }),
    redeemInvite: (token: string) =>
      request<{ communityId: string; status: "joined" }>("/invites/redeem", { method: "POST", body: { token } }),

    announcements: (id: string, page: { limit?: number; offset?: number } = {}) =>
      request<{ announcements: Announcement[] }>(`/${seg(id)}/announcements${query(page)}`),
    announce: (id: string, input: { body: string; pinned?: boolean }) =>
      request<{ announcement: Announcement }>(`/${seg(id)}/announcements`, { method: "POST", body: input })
  };
}

export type CommunityApi = ReturnType<typeof createCommunityApi>;
