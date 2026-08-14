import type { Expo57MigrationEvidence } from "./types.js";
export function assertExpo57MigrationGreen(e:Expo57MigrationEvidence){const failures=Object.entries(e).filter(([,value])=>typeof value==="boolean"&&!value).map(([key])=>key);if(e.fromSdk!==52||e.toSdk!==57)failures.push("SDK_LINEAGE_INVALID");if(failures.length)throw new Error(`EXPO57_MIGRATION_RED:${failures.join(",")}`);}
