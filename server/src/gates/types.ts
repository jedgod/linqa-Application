export type GateName = "G0" | "G1" | "G2" | "G3" | "G4";
export type GateStatus = "RED" | "AMBER" | "GREEN";
export interface GateCheck { id:string; description:string; required:boolean; passed:boolean; evidenceRefs:string[]; detail?:string; }
export interface GateEvidence {
  schemaVersion: 1; gate:GateName; status:GateStatus; generatedAt:string; revision:string;
  environment:"staging"|"production-equivalent"|"production"; checks:GateCheck[];
  summary:{required:number;passed:number;failed:number};
}
