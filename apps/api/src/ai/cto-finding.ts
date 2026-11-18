const DEFECT_TERM =
  /\b(bug|defect|vulnerability|güvenlik açığı|kritik hata|teknik borç|tech debt|broken|regress)/i;

const NEGATIVE_FINDING =
  /\b(bulunamad[ıi]|tespit edilmedi|yok(?:tur)?|no (?:verified )?defect|no tech debt|herhangi bir.{0,48}(?:borç|defect|bug|hata).{0,24}(?:yok|bulunamad))\b/i;

export function claimsActiveDefect(blob: string): boolean {
  if (!DEFECT_TERM.test(blob)) return false;
  if (NEGATIVE_FINDING.test(blob)) return false;
  return true;
}

export type CtoContractKind = "verified_defect_required" | "inspection_ok";

export function classifyCtoContract(acceptanceCriteria: string | null | undefined, title = ""): CtoContractKind {
  const blob = `${title}\n${acceptanceCriteria ?? ""}`;
  if (/\bverified_defect|doğrulanmış\s+(defect|hata|bug)\b/i.test(blob)) {
    return "verified_defect_required";
  }
  return "inspection_ok";
}
