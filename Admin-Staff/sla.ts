import type { Severity } from '../shared/ops-types';
const TARGET_MINUTES: Record<Severity,number> = { LOW:480, MEDIUM:120, HIGH:30, CRITICAL:5 };
export function computeSlaDue(createdAt:string,severity:Severity){ return new Date(Date.parse(createdAt)+TARGET_MINUTES[severity]*60000).toISOString(); }
export function slaState(now:string,due:string){
 const left=(Date.parse(due)-Date.parse(now))/60000;
 if(left<=0) return 'BREACHED'; if(left<=15) return 'WARNING'; return 'ON_TRACK';
}
