export type OpsRealtimeEvent =
 | {type:'CASE_CREATED'; caseId:string; queueId:string}
 | {type:'CASE_ASSIGNED'; caseId:string; staffId:string}
 | {type:'CASE_MESSAGE'; caseId:string; messageId:string; sender:'CLIENT'|'STAFF'}
 | {type:'SLA_WARNING'; caseId:string; minutesRemaining:number}
 | {type:'STAFF_PRESENCE'; staffId:string; presence:'ONLINE'|'BUSY'|'AWAY'|'OFFLINE'}
 | {type:'INCIDENT_CHANGED'; incidentId:string; status:string}
 | {type:'RISK_ALERT'; caseId:string; severity:'HIGH'|'CRITICAL'};

export interface OpsSocketAuth { staffId:string; sessionId:string; permissions:string[]; }

export function authorizeChannel(auth:OpsSocketAuth, channel:string){
  if(channel.startsWith('case:')) return auth.permissions.includes('case:read');
  if(channel.startsWith('incident:')) return auth.permissions.includes('incident:read');
  if(channel==='staff-presence') return auth.permissions.includes('staff:monitor');
  return false;
}
