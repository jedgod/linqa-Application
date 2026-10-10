import { validatePayload } from "./conversation-engine";

/** Adapted from linqa-attachments+backend. Fields stay inside the secure-core envelope. */
export type SharedAttachment =
  | { type: "location"; title: string; address?: string; latitude: number; longitude: number }
  | { type: "contact"; title: string; role?: string; phone?: string; handle?: string };

export function buildSharedAttachment(kind: "LOCATION" | "CONTACT", fields: Record<string, string>): SharedAttachment {
  const title = fields.title?.trim() ?? "";
  const optional = (name: string) => fields[name]?.trim() || undefined;
  const payload: SharedAttachment = kind === "LOCATION"
    ? { type: "location", title, address: optional("address"), latitude: fields.latitude?.trim() ? Number(fields.latitude) : NaN, longitude: fields.longitude?.trim() ? Number(fields.longitude) : NaN }
    : { type: "contact", title, role: optional("role"), phone: optional("phone"), handle: optional("handle") };
  validatePayload(payload);
  return payload;
}

export function sharedAttachmentUrl(payload: SharedAttachment): string | null {
  validatePayload(payload);
  if (payload.type === "location") return `https://www.google.com/maps/search/?api=1&query=${payload.latitude},${payload.longitude}`;
  return payload.phone ? `tel:${encodeURIComponent(payload.phone.replace(/[\s().-]/g, ""))}` : null;
}
