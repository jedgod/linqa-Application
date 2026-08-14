import { useLinqaRuntime } from "./RuntimeProvider";
export function LiveCapabilityGuard({capability,children}:{capability:string;children:React.ReactNode}){
  const{snapshot,loading}=useLinqaRuntime();
  if(loading||!snapshot)return null;
  const state=snapshot.capabilities[capability];
  if(snapshot.mode==="LIVE"&&(!state||state.status!=="READY"))return <div role="alert"><strong>Feature unavailable</strong><p>{state?.reason??"Required live capability is not ready."}</p></div>;
  return <>{children}</>;
}
