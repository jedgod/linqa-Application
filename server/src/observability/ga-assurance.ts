export interface Slo {id:string;description:string;target:number;windowDays:number}
export const LINQA_SLOS:Slo[]=[
  {id:"auth_success_availability",description:"Successful eligible authentication requests",target:.999,windowDays:30},
  {id:"message_relay_availability",description:"Encrypted relay acceptance",target:.9995,windowDays:30},
  {id:"realtime_wake_availability",description:"Realtime wake delivery",target:.995,windowDays:30},
  {id:"message_delivery_latency_p95",description:"Online encrypted-message delivery within two seconds",target:.95,windowDays:30},
  {id:"security_audit_delivery",description:"Security audit event persistence and export",target:.9999,windowDays:30}
];
export interface AlertSample {name:string;value:number;windowMinutes:number}
export type AlertSeverity="INFO"|"WARNING"|"PAGE";
export function classifyAlert(alert:AlertSample):AlertSeverity{if(alert.name==="linqa_transparency_failure_total"&&alert.value>0)return"PAGE";if(alert.name==="linqa_refresh_replay_total"&&alert.value>=10&&alert.windowMinutes<=5)return"PAGE";if(alert.name==="linqa_key_package_rejected_total"&&alert.value>=100&&alert.windowMinutes<=10)return"WARNING";if(alert.name==="linqa_auth_failure_total"&&alert.value>=1000&&alert.windowMinutes<=5)return"WARNING";return"INFO";}
export interface MetricsSink {increment(name:string,labels?:Record<string,string>):void}
export class SecurityMetrics {constructor(private readonly sink:MetricsSink){}authFailure(reason:string){this.sink.increment("linqa_auth_failure_total",{reason});}refreshReplay(){this.sink.increment("linqa_refresh_replay_total");}keyPackageRejected(reason:string){this.sink.increment("linqa_key_package_rejected_total",{reason});}transparencyFailure(reason:string){this.sink.increment("linqa_transparency_failure_total",{reason});}relayLeaseFailure(reason:string){this.sink.increment("linqa_relay_lease_failure_total",{reason});}}
