export const SLO={
  availability:0.999,
  peopleSearchP95Ms:350,
  peopleSearchP99Ms:800,
  errorRateMax:0.01,
  cacheHitTarget:0.70,
  savedSearchJobSuccess:0.995
};

export interface Metrics {
  increment(name:string,tags?:Record<string,string>):void;
  histogram(name:string,value:number,tags?:Record<string,string>):void;
  gauge(name:string,value:number,tags?:Record<string,string>):void;
}

export function recordDiscoveryRequest(
  metrics:Metrics,
  x:{surface:string;latencyMs:number;status:string;cache:"hit"|"miss"}
) {
  metrics.increment("countrylinqa.discovery.requests",{
    surface:x.surface,status:x.status,cache:x.cache
  });
  metrics.histogram("countrylinqa.discovery.latency_ms",x.latencyMs,{surface:x.surface});
}
