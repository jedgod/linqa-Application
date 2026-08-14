import type { RuntimeSnapshot } from "../runtime/types";

export interface MessagingService {
  send(input: unknown): Promise<unknown>;
}

export interface CallService {
  start(input: unknown): Promise<unknown>;
}

export interface AttachmentService {
  upload(input: unknown): Promise<unknown>;
}

export interface ServiceRegistry {
  messaging: MessagingService;
  calls: CallService;
  attachments: AttachmentService;
}

class DemoMessagingService implements MessagingService {
  async send(input: unknown) {
    const messages = JSON.parse(
      localStorage.getItem("linqa.demo.messages") ?? "[]"
    );
    messages.push({
      id: crypto.randomUUID(),
      input,
      createdAt: new Date().toISOString(),
      simulated: true
    });
    localStorage.setItem("linqa.demo.messages", JSON.stringify(messages));
    return { simulated: true };
  }
}

class DisabledMessagingService implements MessagingService {
  async send(): Promise<never> {
    throw new Error("Secure messaging is unavailable.");
  }
}

class DemoCallService implements CallService {
  async start(input: unknown) {
    return {
      callId: crypto.randomUUID(),
      input,
      simulated: true,
      status: "ACTIVE"
    };
  }
}

class DisabledCallService implements CallService {
  async start(): Promise<never> {
    throw new Error("Calling is unavailable.");
  }
}

class DemoAttachmentService implements AttachmentService {
  async upload(input: unknown) {
    return {
      attachmentId: crypto.randomUUID(),
      input,
      simulated: true
    };
  }
}

class DisabledAttachmentService implements AttachmentService {
  async upload(): Promise<never> {
    throw new Error("Attachment upload is unavailable.");
  }
}

export function createServiceRegistry(
  snapshot: RuntimeSnapshot,
  live: Partial<ServiceRegistry> = {}
): ServiceRegistry {
  const messagingState = snapshot.capabilities.encryptedMessaging;
  const callState = snapshot.capabilities.videoModes;
  const attachmentState = snapshot.capabilities.attachments;

  return {
    messaging:
      messagingState.status === "READY" && live.messaging
        ? live.messaging
        : messagingState.enabled
          ? new DemoMessagingService()
          : new DisabledMessagingService(),

    calls:
      callState.status === "READY" && live.calls
        ? live.calls
        : callState.enabled
          ? new DemoCallService()
          : new DisabledCallService(),

    attachments:
      attachmentState.status === "READY" && live.attachments
        ? live.attachments
        : attachmentState.enabled
          ? new DemoAttachmentService()
          : new DisabledAttachmentService()
  };
}
