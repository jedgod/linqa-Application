import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { createAuthenticator, requireScope } from "../auth/jwt.js";
import type { GaReleaseGateService } from "../services/ga-release-gate.service.js";
import type { PrivacyRightsService } from "../services/privacy-rights.service.js";
import type { SupportOperationsService } from "../services/support-operations.service.js";
import type { DataResidencyService } from "../services/data-residency.service.js";
import type { SecurityAssessmentService } from "../services/security-assessment.service.js";
import type { RetentionArchiveService } from "../services/retention-archive.service.js";
import type { IncidentResponseService } from "../services/incident-response.service.js";
import type { ProductionKillSwitchService } from "../services/production-kill-switch.service.js";
import type { GaRolloutService } from "../services/ga-rollout.service.js";
import type { DiagnosticRedactionService } from "../services/diagnostic-redaction.service.js";

export interface GaHardeningServices {
  gates: GaReleaseGateService;
  privacyRights: PrivacyRightsService;
  support: SupportOperationsService;
  residency: DataResidencyService;
  securityAssessment: SecurityAssessmentService;
  retentionArchive: RetentionArchiveService;
  incidentResponse: IncidentResponseService;
  productionKillSwitches: ProductionKillSwitchService;
  gaRollout: GaRolloutService;
  diagnosticRedaction: DiagnosticRedactionService;
}

export async function registerGaHardeningRoutes(app: FastifyInstance, config: AppConfig, s: GaHardeningServices) {
  const auth = createAuthenticator(config);

  app.get("/v4/ga/readiness", async (request) => {
    const p = await auth(request);
    requireScope(p, "developer:read");
    return s.gates.summary();
  });

  app.post("/v4/privacy/requests", async (request, reply) => {
    const p = await auth(request);
    requireScope(p, "account:write");

    const body = z
      .object({
        type: z.enum(["ACCESS", "PORTABILITY", "DELETE", "CORRECT", "OPT_OUT_SALE", "OPT_OUT_SHARING", "LIMIT_SENSITIVE_USE"]),
        jurisdiction: z.string().min(2).max(20)
      })
      .parse(request.body);

    return reply.code(202).send(
      await s.privacyRights.create({
        userId: p.userId,
        ...(p.deviceId !== undefined ? { deviceId: p.deviceId } : {}),
        type: body.type,
        jurisdiction: body.jurisdiction
      })
    );
  });

  app.post("/v4/support/cases", async (request, reply) => {
    const p = await auth(request);

    const body = z
      .object({
        category: z.string().min(2).max(80),
        priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]),
        subject: z.string().min(3).max(200),
        description: z.string().min(5).max(5000)
      })
      .parse(request.body);

    return reply.code(201).send(
      await s.support.createCase({
        userId: p.userId,
        category: body.category,
        priority: body.priority,
        subject: body.subject,
        description: body.description
      })
    );
  });

  app.get("/v4/residency", async (request) => {
    const p = await auth(request);
    requireScope(p, "privacy:read");

    return {
      assignment: await s.residency.assignment("USER", p.userId)
    };
  });

  // Everything below is not part of the source pack's own route file — added
  // 2026-08-07 to give these already-built, tested services a real caller.
  // All are operations/security-admin surfaces, gated on "developer:write".

  app.post("/v4/security/assessments", async (request, reply) => {
    const p = await auth(request);
    requireScope(p, "developer:write");

    const body = z
      .object({
        type: z.enum(["CRYPTO_AUDIT", "PEN_TEST", "ARCH_REVIEW", "MOBILE_REVIEW"]),
        assessor: z.string().min(1).max(200),
        reportReference: z.string().min(1).max(500),
        reportHashBase64: z.string().min(1),
        completedAt: z.string().datetime().optional()
      })
      .parse(request.body);

    const assessment = await s.securityAssessment.registerAssessment({
      type: body.type,
      assessor: body.assessor,
      reportReference: body.reportReference,
      reportHash: Buffer.from(body.reportHashBase64, "base64"),
      ...(body.completedAt !== undefined ? { completedAt: new Date(body.completedAt) } : {})
    });

    return reply.code(201).send(assessment);
  });

  app.post("/v4/security/findings", async (request, reply) => {
    const p = await auth(request);
    requireScope(p, "developer:write");

    const body = z
      .object({
        assessmentId: z.string().uuid().optional(),
        key: z.string().min(1).max(200),
        severity: z.enum(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]),
        title: z.string().min(1).max(300),
        description: z.string().min(1).max(5000),
        owner: z.string().max(200).optional(),
        dueAt: z.string().datetime().optional()
      })
      .parse(request.body);

    const finding = await s.securityAssessment.createFinding({
      ...(body.assessmentId !== undefined ? { assessmentId: body.assessmentId } : {}),
      key: body.key,
      severity: body.severity,
      title: body.title,
      description: body.description,
      ...(body.owner !== undefined ? { owner: body.owner } : {}),
      ...(body.dueAt !== undefined ? { dueAt: new Date(body.dueAt) } : {})
    });

    return reply.code(201).send(finding);
  });

  app.post("/v4/security/findings/:findingId/close", async (request, reply) => {
    const p = await auth(request);
    requireScope(p, "developer:write");

    const params = z.object({ findingId: z.string().uuid() }).parse(request.params);
    const body = z.object({ evidenceUri: z.string().min(1).max(1000) }).parse(request.body);

    const finding = await s.securityAssessment.closeFinding({
      findingId: params.findingId,
      verifier: p.userId,
      evidenceUri: body.evidenceUri
    });

    return reply.code(200).send(finding);
  });

  app.post("/v4/retention/jobs", async (request, reply) => {
    const p = await auth(request);
    requireScope(p, "developer:write");

    const body = z.object({ dataClass: z.string().min(1).max(100), cutoffAt: z.string().datetime() }).parse(request.body);
    const job = await s.retentionArchive.queue(body.dataClass, new Date(body.cutoffAt));

    return reply.code(201).send(job);
  });

  app.post("/v4/retention/jobs/:jobId/archive", async (request, reply) => {
    const p = await auth(request);
    requireScope(p, "developer:write");

    const params = z.object({ jobId: z.string().uuid() }).parse(request.params);
    const result = await s.retentionArchive.archiveSecurityAudit(params.jobId);

    return reply.code(200).send(result);
  });

  app.post("/v4/incidents", async (request, reply) => {
    const p = await auth(request);
    requireScope(p, "developer:write");

    const body = z
      .object({
        incidentKey: z.string().min(1).max(200),
        title: z.string().min(1).max(300),
        severity: z.enum(["SEV0", "SEV1", "SEV2", "SEV3", "SEV4"]),
        securityRelated: z.boolean().optional(),
        privacyRelated: z.boolean().optional(),
        impact: z.string().max(2000).optional()
      })
      .parse(request.body);

    const incident = await s.incidentResponse.declare({
      incidentKey: body.incidentKey,
      title: body.title,
      severity: body.severity,
      commander: p.userId,
      ...(body.securityRelated !== undefined ? { securityRelated: body.securityRelated } : {}),
      ...(body.privacyRelated !== undefined ? { privacyRelated: body.privacyRelated } : {}),
      ...(body.impact !== undefined ? { impact: body.impact } : {})
    });

    return reply.code(201).send(incident);
  });

  app.post("/v4/incidents/:incidentId/transitions", async (request, reply) => {
    const p = await auth(request);
    requireScope(p, "developer:write");

    const params = z.object({ incidentId: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        state: z.enum(["INVESTIGATING", "MITIGATING", "MONITORING", "RESOLVED", "POSTMORTEM"]),
        message: z.string().min(1).max(2000)
      })
      .parse(request.body);

    await s.incidentResponse.transition({
      incidentId: params.incidentId,
      actor: p.userId,
      state: body.state,
      message: body.message
    });

    return reply.code(204).send();
  });

  app.get("/v4/kill-switches", async (request) => {
    const p = await auth(request);
    requireScope(p, "developer:read");
    return { switches: await s.productionKillSwitches.list() };
  });

  app.put("/v4/kill-switches/:key", async (request, reply) => {
    const p = await auth(request);
    requireScope(p, "developer:write");

    const params = z.object({ key: z.string().min(1).max(100) }).parse(request.params);
    const body = z.object({ enabled: z.boolean(), reason: z.string().min(1).max(500) }).parse(request.body);

    const result = await s.productionKillSwitches.set({
      key: params.key,
      enabled: body.enabled,
      actor: p.userId,
      reason: body.reason
    });

    return reply.code(200).send(result);
  });

  app.post("/v4/ga/rollouts", async (request, reply) => {
    const p = await auth(request);
    requireScope(p, "developer:write");

    const body = z.object({ version: z.string().min(1).max(60), audience: z.string().min(1).max(60) }).parse(request.body);
    const rollout = await s.gaRollout.create({ version: body.version, audience: body.audience, requestedBy: p.userId });

    return reply.code(201).send(rollout);
  });

  app.post("/v4/ga/rollouts/:rolloutId/promote", async (request, reply) => {
    const p = await auth(request);
    requireScope(p, "developer:write");

    const params = z.object({ rolloutId: z.string().uuid() }).parse(request.params);
    const body = z.object({ nextPercentage: z.number().int() }).parse(request.body);

    const rollout = await s.gaRollout.promote({
      rolloutId: params.rolloutId,
      requestedBy: p.userId,
      approver: p.userId,
      nextPercentage: body.nextPercentage
    });

    return reply.code(200).send(rollout);
  });

  app.post("/v4/ga/rollouts/:rolloutId/rollback", async (request, reply) => {
    const p = await auth(request);
    requireScope(p, "developer:write");

    const params = z.object({ rolloutId: z.string().uuid() }).parse(request.params);
    const rollout = await s.gaRollout.rollback(params.rolloutId, p.userId);

    return reply.code(200).send(rollout);
  });

  app.post("/v4/diagnostics/redact", async (request, reply) => {
    const p = await auth(request);
    requireScope(p, "developer:read");

    return reply.code(200).send({ redacted: s.diagnosticRedaction.redact(request.body ?? {}) });
  });
}
