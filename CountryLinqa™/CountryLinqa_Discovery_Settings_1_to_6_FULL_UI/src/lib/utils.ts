export type ClassValue=string|false|null|undefined|Record<string,boolean>;
export function cn(...v:ClassValue[]){const o:string[]=[];for(const x of v){if(!x)continue;if(typeof x==='string')o.push(x);else for(const [k,e] of Object.entries(x))if(e)o.push(k)}return o.join(' ')}
