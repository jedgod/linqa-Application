import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import type { Database } from "../../db/pool.js";
import type { RealtimeHub } from "../../realtime/hub.js";
import { createAuthenticator, requireScope } from "../../auth/jwt.js";
import { CaseAssignmentService } from "../../services/operations/case-assignment.service.js";
import { StaffOperationsService } from "../../services/operations/staff-operations.service.js";
import { OperationsDashboardService } from "../../services/operations/dashboard.service.js";
import { InternalNotesService } from "../../services/operations/internal-notes.service.js";
import { SupportOperationsService } from "../../services/support-operations.service.js";
import { CaseStateService } from "../../services/operations/case-state.service.js";
import { CaseMessagesService } from "../../services/operations/case-messages.service.js";
import { ExistingHubSupportReplyDelivery } from "../../services/operations/support-reply-delivery.adapter.js";
import { Client360Service } from "../../services/operations/client360.service.js";
import { RecoveryEvidenceService } from "../../services/operations/recovery-evidence.service.js";
import { RecoveryReviewService, requiredScopeForDecision } from "../../services/operations/recovery-review.service.js";
import { FraudRiskEvidenceService } from "../../services/operations/fraud-risk-evidence.service.js";
import { FraudRiskReviewService, requiredScopeForRiskDecision } from "../../services/operations/fraud-risk-review.service.js";
import { LinqaSendEvidenceService } from "../../services/operations/linqasend-evidence.service.js";
import { LinqaSendReviewService, requiredScopeForLinqaSendDecision } from "../../services/operations/linqasend-review.service.js";

function withErrors<T>(handler: (request: FastifyRequest, reply: FastifyReply) => Promise<T>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      return await handler(request, reply);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.code(422).send({ error: "validation_error", details: error.flatten() });
      }
      const status = typeof error?.statusCode === "number" ? error.statusCode : 400;
      const code = error?.message ?? "invalid_request";
      request.log.warn({ err: error }, "operations request rejected");
      return reply.code(status).send({ error: code });
    }
  };
}

const CaseParams = z.object({ caseId: z.string().uuid() });
const AssignBody = z.object({ staffId: z.string().uuid(), reasonCode: z.string().min(3).max(200) });
const ReleaseBody = z.object({ reasonCode: z.string().min(3).max(200) });
const NoteBody = z.object({ body: z.string().min(1).max(10000) });
const StateBody = z.object({
  state: z.enum(["OPEN", "WAITING_USER", "WAITING_INTERNAL", "RESOLVED", "CLOSED"]),
  reasonCode: z.string().min(3).max(200)
});
const PriorityBody = z.object({
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]),
  reasonCode: z.string().min(3).max(200)
});
const ReplyBody = z.object({ body: z.string().trim().min(1).max(8000) });
// The recovery, fraud & risk, and LinqaSend specialist reviews take an
// identical decision payload, so they share one schema rather than three
// copies that could drift on note/reason limits.
const SpecialistDecisionBody = z.object({
  decision: z.enum(["APPROVED", "REJECTED", "ESCALATED"]),
  specialistNote: z.string().trim().min(3).max(4000),
  reasonCode: z.string().trim().min(3).max(100)
});

export async function registerOperationsRoutes(app: FastifyInstance, config: AppConfig, db: Database, hub: RealtimeHub) {
  const auth = createAuthenticator(config);
  const assignment = new CaseAssignmentService(db, hub);
  const staff = new StaffOperationsService(db);
  const dashboard = new OperationsDashboardService(db);
  const notes = new InternalNotesService(db);
  const supportOperations = new SupportOperationsService(db);
  const caseState = new CaseStateService(db);
  const caseMessages = new CaseMessagesService(db, new ExistingHubSupportReplyDelivery(hub));
  const client360 = new Client360Service(db);
  const recoveryEvidence = new RecoveryEvidenceService(db);
  const recoveryReview = new RecoveryReviewService(db);
  const fraudRiskEvidence = new FraudRiskEvidenceService(db);
  const fraudRiskReview = new FraudRiskReviewService(db);
  const linqaSendEvidence = new LinqaSendEvidenceService(db);
  const linqaSendReview = new LinqaSendReviewService(db);

  app.get(
    "/v1/admin/operations/dashboard",
    withErrors(async (request) => {
      const p = await auth(request);
      requireScope(p, "ops:dashboard:read");
      return dashboard.overview();
    })
  );

  app.get(
    "/v1/admin/operations/staff/live",
    withErrors(async (request) => {
      const p = await auth(request);
      requireScope(p, "ops:staff:read");
      return { items: await staff.listLiveStaff() };
    })
  );

  app.get(
    "/v1/admin/operations/staff/my-work",
    withErrors(async (request) => {
      const p = await auth(request);
      requireScope(p, "ops:case:read");
      return { items: await staff.getMyWork(p.userId) };
    })
  );

  app.get(
    "/v1/admin/operations/staff/me",
    withErrors(async (request, reply) => {
      const p = await auth(request);
      requireScope(p, "ops:case:read");
      const profile = await staff.getProfileByUserId(p.userId);
      if (!profile) return reply.code(404).send({ error: "STAFF_PROFILE_NOT_FOUND" });
      return profile;
    })
  );

  app.get(
    "/v1/admin/operations/cases/unassigned",
    withErrors(async (request) => {
      const p = await auth(request);
      requireScope(p, "ops:case:read");
      const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25) }).parse(request.query);
      return { items: await staff.listUnassigned(query.limit) };
    })
  );

  app.get(
    "/v1/admin/operations/cases/:caseId",
    withErrors(async (request, reply) => {
      const p = await auth(request);
      requireScope(p, "ops:case:read");
      const { caseId } = CaseParams.parse(request.params);

      const caseRow = await supportOperations.getCaseById(caseId);
      if (!caseRow) return reply.code(404).send({ error: "CASE_NOT_FOUND" });

      const [clientSummary, assignedStaff, events, caseNotes] = await Promise.all([
        caseRow.user_id ? getClientSummary(db, caseRow.user_id) : Promise.resolve(null),
        caseRow.assigned_staff_id ? getStaffSummary(db, caseRow.assigned_staff_id) : Promise.resolve(null),
        supportOperations.listEvents(caseId),
        notes.list(caseId)
      ]);

      return { case: caseRow, clientSummary, assignedStaff, events, notes: caseNotes };
    })
  );

  app.post(
    "/v1/admin/operations/cases/:caseId/notes",
    withErrors(async (request, reply) => {
      const p = await auth(request);
      requireScope(p, "ops:case:note");
      const { caseId } = CaseParams.parse(request.params);
      const body = NoteBody.parse(request.body);

      const caseRow = await supportOperations.getCaseById(caseId);
      if (!caseRow) return reply.code(404).send({ error: "CASE_NOT_FOUND" });

      const note = await notes.add({ caseId, authorUserId: p.userId, body: body.body });
      await supportOperations.addEvent({
        caseId,
        actorType: "STAFF",
        actorId: p.userId,
        eventType: "ops.case.note_added",
        body: "Internal note added",
        private: true
      });
      return note;
    })
  );

  app.patch(
    "/v1/admin/operations/cases/:caseId/state",
    withErrors(async (request) => {
      const p = await auth(request);
      requireScope(p, "ops:case:resolve");
      const { caseId } = CaseParams.parse(request.params);
      const body = StateBody.parse(request.body);
      return caseState.updateState({
        caseId,
        actorUserId: p.userId,
        actorScopes: [...p.scopes],
        state: body.state,
        reasonCode: body.reasonCode,
        requestId: request.id
      });
    })
  );

  app.patch(
    "/v1/admin/operations/cases/:caseId/priority",
    withErrors(async (request) => {
      const p = await auth(request);
      requireScope(p, "ops:case:priority");
      const { caseId } = CaseParams.parse(request.params);
      const body = PriorityBody.parse(request.body);
      return caseState.updatePriority({
        caseId,
        actorUserId: p.userId,
        actorScopes: [...p.scopes],
        priority: body.priority,
        reasonCode: body.reasonCode,
        requestId: request.id
      });
    })
  );

  app.post(
    "/v1/admin/operations/cases/:caseId/assign",
    withErrors(async (request) => {
      const p = await auth(request);
      requireScope(p, "ops:case:assign");
      const { caseId } = CaseParams.parse(request.params);
      const body = AssignBody.parse(request.body);
      return assignment.assign({
        caseId,
        targetStaffId: body.staffId,
        actorUserId: p.userId,
        actorScopes: [...p.scopes],
        reasonCode: body.reasonCode,
        assignmentType: "MANUAL",
        requestId: request.id
      });
    })
  );

  app.post(
    "/v1/admin/operations/cases/:caseId/release",
    withErrors(async (request) => {
      const p = await auth(request);
      requireScope(p, "ops:case:release");
      const { caseId } = CaseParams.parse(request.params);
      const body = ReleaseBody.parse(request.body);
      return assignment.release({
        caseId,
        actorUserId: p.userId,
        actorScopes: [...p.scopes],
        reasonCode: body.reasonCode,
        requestId: request.id
      });
    })
  );

  app.get(
    "/v1/admin/operations/cases/:caseId/messages",
    withErrors(async (request) => {
      const p = await auth(request);
      requireScope(p, "ops:case:read");
      const { caseId } = CaseParams.parse(request.params);
      return { items: await caseMessages.list(caseId) };
    })
  );

  app.post(
    "/v1/admin/operations/cases/:caseId/reply",
    withErrors(async (request, reply) => {
      const p = await auth(request);
      requireScope(p, "ops:case:reply");
      const { caseId } = CaseParams.parse(request.params);
      const body = ReplyBody.parse(request.body);
      const message = await caseMessages.reply({
        caseId,
        actorUserId: p.userId,
        actorScopes: [...p.scopes],
        body: body.body,
        requestId: request.id
      });
      return reply.code(201).send(message);
    })
  );

  app.get(
    "/v1/admin/operations/cases/:caseId/client360",
    withErrors(async (request) => {
      const p = await auth(request);
      requireScope(p, "ops:client360:read");
      const { caseId } = CaseParams.parse(request.params);
      return client360.getForCase(caseId);
    })
  );

  app.get(
    "/v1/admin/operations/cases/:caseId/recovery",
    withErrors(async (request, reply) => {
      const p = await auth(request);
      requireScope(p, "ops:recovery:read");
      const { caseId } = CaseParams.parse(request.params);
      const result = await recoveryEvidence.getForCase(caseId);
      if (!result) return reply.code(404).send({ error: "CASE_NOT_FOUND" });
      return result;
    })
  );

  app.post(
    "/v1/admin/operations/cases/:caseId/recovery/decision",
    withErrors(async (request) => {
      const p = await auth(request);
      requireScope(p, "ops:recovery:review");
      const { caseId } = CaseParams.parse(request.params);
      const body = SpecialistDecisionBody.parse(request.body);
      requireScope(p, requiredScopeForDecision(body.decision));
      return recoveryReview.saveReview({
        caseId,
        reviewerUserId: p.userId,
        reviewerScopes: [...p.scopes],
        decision: body.decision,
        specialistNote: body.specialistNote,
        reasonCode: body.reasonCode,
        requestId: request.id
      });
    })
  );

  app.get(
    "/v1/admin/operations/cases/:caseId/risk",
    withErrors(async (request, reply) => {
      const p = await auth(request);
      requireScope(p, "ops:risk:read");
      const { caseId } = CaseParams.parse(request.params);
      const result = await fraudRiskEvidence.getForCase(caseId);
      if (!result) return reply.code(404).send({ error: "CASE_NOT_FOUND" });
      return result;
    })
  );

  app.post(
    "/v1/admin/operations/cases/:caseId/risk/decision",
    withErrors(async (request) => {
      const p = await auth(request);
      requireScope(p, "ops:risk:review");
      const { caseId } = CaseParams.parse(request.params);
      const body = SpecialistDecisionBody.parse(request.body);
      requireScope(p, requiredScopeForRiskDecision(body.decision));
      return fraudRiskReview.saveReview({
        caseId,
        reviewerUserId: p.userId,
        reviewerScopes: [...p.scopes],
        decision: body.decision,
        specialistNote: body.specialistNote,
        reasonCode: body.reasonCode,
        requestId: request.id
      });
    })
  );

  app.get(
    "/v1/admin/operations/cases/:caseId/linqasend",
    withErrors(async (request, reply) => {
      const p = await auth(request);
      requireScope(p, "ops:linqasend:read");
      const { caseId } = CaseParams.parse(request.params);
      const result = await linqaSendEvidence.getForCase(caseId);
      if (!result) return reply.code(404).send({ error: "CASE_NOT_FOUND" });
      return result;
    })
  );

  app.post(
    "/v1/admin/operations/cases/:caseId/linqasend/decision",
    withErrors(async (request) => {
      const p = await auth(request);
      requireScope(p, "ops:linqasend:review");
      const { caseId } = CaseParams.parse(request.params);
      const body = SpecialistDecisionBody.parse(request.body);
      requireScope(p, requiredScopeForLinqaSendDecision(body.decision));
      return linqaSendReview.saveReview({
        caseId,
        reviewerUserId: p.userId,
        reviewerScopes: [...p.scopes],
        decision: body.decision,
        specialistNote: body.specialistNote,
        reasonCode: body.reasonCode,
        requestId: request.id
      });
    })
  );
}

// users (001_initial.sql) is deliberately identity-minimal -- no email/phone
// live on it directly (those are normalized elsewhere in the auth/OTP
// flow, not traced here). This exposes only what's actually on the row
// today rather than guessing at contact-detail columns that don't exist.
async function getClientSummary(db: Database, userId: string) {
  const r = await db.query(
    `SELECT id, status, created_at,
            verified_country_code AS "verifiedCountryCode",
            country_verification_state AS "countryVerificationState"
     FROM users WHERE id = $1`,
    [userId]
  );
  return r.rows[0] ?? null;
}

async function getStaffSummary(db: Database, staffId: string) {
  const r = await db.query(
    `SELECT id, display_name AS "displayName", staff_role AS "staffRole",
            team_name AS "teamName", presence::text
     FROM ops_staff_profiles WHERE id = $1`,
    [staffId]
  );
  return r.rows[0] ?? null;
}
