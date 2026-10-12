let owner: "legacy" | "rooms" | null = null;
export function claimCall(next: "legacy" | "rooms"): boolean { if(owner && owner!==next)return false;owner=next;return true; }
export function releaseCall(previous: "legacy" | "rooms"): void { if(owner===previous)owner=null; }
export function anotherCallActive(next: "legacy" | "rooms"): boolean { return !!owner && owner!==next; }
