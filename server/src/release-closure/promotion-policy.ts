import type { ReleaseStage } from "./types.js";
const ORDER:ReleaseStage[]=["DEVELOPMENT","RC_CANDIDATE","RC_FROZEN","CANARY","LIMITED_AVAILABILITY","GA"];
export function assertPromotionAllowed(current:ReleaseStage,requested:ReleaseStage){if(ORDER.indexOf(requested)!==ORDER.indexOf(current)+1)throw new Error("INVALID_RELEASE_STAGE_TRANSITION");}
