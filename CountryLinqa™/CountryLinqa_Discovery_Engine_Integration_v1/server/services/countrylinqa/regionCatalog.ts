export const REGION_COUNTRIES: Record<string,string[]> = {
  "NA": ["US","CA","MX"],
  "EU": ["GB","IE","FR","DE","ES","IT","PT","NL","BE","SE","NO","DK","FI","PL"],
  "AF-W": ["GH","NG","CI","SN","GM","SL","LR","TG","BJ","BF","ML","NE","GN","GW","CV"],
  "AF-E": ["KE","UG","TZ","RW","BI","ET","SO","DJ","ER","SS"],
  "AF-C": ["CM","CF","TD","CG","CD","GQ","GA","ST"],
  "AF-S": ["ZA","BW","NA","ZM","ZW","MW","MZ","LS","SZ","AO"],
  "ME": ["AE","SA","QA","KW","BH","OM","JO","LB","IL","IQ"],
  "CAR": ["JM","TT","BB","BS","HT","DO","GD","LC","VC","AG","DM","KN"],
  "APAC": ["JP","KR","CN","IN","SG","MY","TH","VN","PH","ID","AU","NZ"],
  "SA": ["BR","AR","CL","CO","PE","EC","UY","PY","BO","GY","SR","VE"]
};

export function countriesForRegion(region:string|null):string[] {
  return region ? REGION_COUNTRIES[region] ?? [] : [];
}
