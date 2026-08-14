import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { createAuthenticator, requireScope } from "../auth/jwt.js";
import type { PhoneRegistrationService } from "../services/phone-registration.service.js";
import type { MultiAccountService } from "../services/multi-account.service.js";
import type { AccountSwitchService } from "../services/account-switch.service.js";
import type { AccountPushIsolationService } from "../services/account-push-isolation.service.js";

export interface MultiAccountServices {
  phoneRegistration: PhoneRegistrationService;
  multiAccount: MultiAccountService;
  accountSwitch: AccountSwitchService;
  pushIsolation: AccountPushIsolationService;
}

export async function registerMultiAccountRoutes(app: FastifyInstance, config: AppConfig, s: MultiAccountServices) {
  const auth = createAuthenticator(config);

  app.post("/v5/phone-verification/start", async (request, reply) => {
    const p = await auth(request);
    requireScope(p, "account:write");

    const body = z
      .object({
        phoneNumber: z.string().min(4).max(32),
        defaultCountry: z.string().length(2).optional()
      })
      .parse(request.body);

    const result = await s.phoneRegistration.begin({
      userId: p.userId,
      rawNumber: body.phoneNumber,
      ...(body.defaultCountry !== undefined ? { defaultCountry: body.defaultCountry } : {})
    });

    return reply.code(202).send(result);
  });

  app.post("/v5/phone-verification/complete", async (request, reply) => {
    const p = await auth(request);
    requireScope(p, "account:write");

    const body = z
      .object({
        phoneIdentityId: z.string().uuid(),
        challengeId: z.string().uuid(),
        code: z.string().regex(/^\d{6}$/)
      })
      .parse(request.body);

    return reply.send(
      await s.phoneRegistration.complete({
        userId: p.userId,
        phoneIdentityId: body.phoneIdentityId,
        challengeId: body.challengeId,
        code: body.code
      })
    );
  });

  // Not part of the source pack — see MultiAccountService.registerInstallation.
  app.post("/v5/installations", async (request, reply) => {
    await auth(request);

    const body = z
      .object({
        installationPublicId: z.string().min(8).max(200),
        platform: z.enum(["IOS", "ANDROID", "WEB", "WINDOWS", "MACOS", "LINUX"])
      })
      .parse(request.body);

    return reply.code(201).send(await s.multiAccount.registerInstallation(body));
  });

  app.get("/v5/installations/:installationId/accounts", async (request) => {
    const p = await auth(request);
    const params = z.object({ installationId: z.string().uuid() }).parse(request.params);

    const accounts = await s.multiAccount.list(params.installationId);

    if (!accounts.some((a: any) => a.user_id === p.userId)) {
      throw new Error("installation_access_denied");
    }

    return { accounts };
  });

  app.post("/v5/installations/:installationId/accounts", async (request, reply) => {
    const p = await auth(request);
    requireScope(p, "account:write");

    const params = z.object({ installationId: z.string().uuid() }).parse(request.params);

    const body = z
      .object({
        targetUserId: z.string().uuid(),
        label: z.string().max(60).optional()
      })
      .parse(request.body);

    // In production, targetUserId must come from a freshly authenticated
    // add-account ceremony, not arbitrary client input.
    const result = await s.multiAccount.add({
      installationId: params.installationId,
      userId: body.targetUserId,
      ...(body.label !== undefined ? { label: body.label } : {})
    });

    return reply.code(201).send(result);
  });

  app.post("/v5/installations/:installationId/switch", async (request, reply) => {
    const p = await auth(request);

    const params = z.object({ installationId: z.string().uuid() }).parse(request.params);
    const body = z.object({ toUserId: z.string().uuid() }).parse(request.body);

    if (!p.deviceId) {
      return reply.code(401).send({ error: "device_bound_token_required" });
    }

    return s.accountSwitch.switch({
      installationId: params.installationId,
      fromUserId: p.userId,
      toUserId: body.toUserId,
      deviceId: p.deviceId
    });
  });

  app.delete("/v5/installations/:installationId/accounts/:userId", async (request, reply) => {
    const p = await auth(request);

    const params = z
      .object({
        installationId: z.string().uuid(),
        userId: z.string().uuid()
      })
      .parse(request.params);

    if (params.userId !== p.userId) {
      requireScope(p, "account:write");
    }

    await s.multiAccount.remove({
      installationId: params.installationId,
      userId: params.userId
    });

    return reply.code(204).send();
  });

  // Not part of the source pack's route list, but AccountPushIsolationService
  // needs a caller for the "isolated push tokens" goal in README.md item 12
  // to be reachable rather than dead code.
  app.put("/v5/installations/:installationId/push-bindings", async (request, reply) => {
    const p = await auth(request);
    requireScope(p, "account:write");

    const params = z.object({ installationId: z.string().uuid() }).parse(request.params);

    const body = z
      .object({
        provider: z.enum(["APNS", "FCM", "WEB_PUSH"]),
        token: z.string().min(8)
      })
      .parse(request.body);

    if (!p.deviceId) {
      return reply.code(401).send({ error: "device_bound_token_required" });
    }

    await s.pushIsolation.bind({
      installationId: params.installationId,
      userId: p.userId,
      deviceId: p.deviceId,
      provider: body.provider,
      token: body.token
    });

    return reply.code(204).send();
  });
}
