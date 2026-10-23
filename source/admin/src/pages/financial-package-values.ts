type Row = Record<string, unknown>;
export function financialEditValues(card: Row): Row {
  const current = ((card.financial_versions as Row[]) ?? []).find(v => v.id === card.financial_version_id);
  if (!current) return {};
  const parts = (current.documents as Row[]) ?? [];
  return { obligation_id: current.obligation_id, period_from: current.period_from, period_to: current.period_to,
    report_version_id: parts.find(p => p.code === "report")?.document_version_id,
    basis_versions: parts.filter(p => p.code !== "report").map(p => ({ code: p.code, document_version_id: p.document_version_id })),
    disclosed_version_ids: parts.filter(p => p.code !== "report" && p.disclosed === true).map(p => p.document_version_id),
    correction_note: card.state === "published" ? "" : current.correction_note ?? "" };
}
export function financialPublicationValues(values: Row): Row {
  if (values.kind !== "financial_report") return values;
  return { ...values, requires_document: true, disclosed_version_ids: [...new Set([values.report_version_id, ...((values.disclosed_version_ids as string[]) ?? [])])] };
}
