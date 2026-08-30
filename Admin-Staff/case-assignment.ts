type Agent={id:string;presence:string;active:number;max:number;skills:string[];region?:string};
type Work={type:string;region?:string;severity:string};
export function rankAgents(agents:Agent[],work:Work){return agents.filter(a=>a.presence==='ONLINE'&&a.active<a.max&&a.skills.includes(work.type)).map(a=>({agent:a,score:(a.region===work.region?20:0)+(a.max-a.active)*5+(work.severity==='CRITICAL'?10:0)})).sort((a,b)=>b.score-a.score)}
