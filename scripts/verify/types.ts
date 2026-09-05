export interface CheckResult {
  ok: boolean;
  evidence: string[];
  notes?: string[];
}
export interface Check {
  id: string;
  name: string;
  phase: string;
  run(): Promise<CheckResult>;
}
export const pass = (evidence: string[], notes?: string[]): CheckResult => ({ ok: true, evidence, notes });
export const fail = (evidence: string[], notes?: string[]): CheckResult => ({ ok: false, evidence, notes });
