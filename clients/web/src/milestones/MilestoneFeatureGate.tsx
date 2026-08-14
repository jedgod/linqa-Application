import { useEffect,useState } from "react";

export function MilestoneFeatureGate(props:{
  apiBaseUrl:string;
  token:string;
  featureKey:string;
  clientVersion:string;
  children:React.ReactNode;
  fallback?:React.ReactNode;
}) {
  const [enabled,setEnabled]=useState<boolean|null>(null);

  useEffect(()=>{
    let active=true;
    fetch(
      `${props.apiBaseUrl}/v1/milestones/features/${encodeURIComponent(props.featureKey)}?clientVersion=${encodeURIComponent(props.clientVersion)}`,
      {headers:{authorization:`Bearer ${props.token}`}}
    )
      .then(async r=>{
        if(!r.ok) throw new Error();
        return r.json();
      })
      .then(v=>{if(active)setEnabled(v.enabled===true);})
      .catch(()=>{if(active)setEnabled(false);});

    return()=>{active=false;};
  },[props.apiBaseUrl,props.token,props.featureKey,props.clientVersion]);

  if(enabled===null)return null;
  return enabled?<>{props.children}</>:<>{props.fallback??null}</>;
}
