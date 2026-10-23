import type { Actor } from "../../pdp/types.ts";
import { ApiError } from "../../errors/api.ts";
import { invalid, jsonValue, type Row } from "../registry/validation.ts";
import { recordAudit, type RegistryDeps } from "../registry/service.ts";
import { content, idempotent } from "../requests/service.ts";
import { checkVersion } from "../requests/fsm.ts";
import { checkedDocumentVersions } from "../documents/provider.ts";
import type { FinancialRule } from "./financial.ts";
import { requireFinancialObligation } from "./financial-obligations.ts";
import { missingFinancialPlacements } from "./obligation-policy.ts";

/** Только явное доказательство сотрудника. Отправка outbox сюда не обращается. */
export async function recordFinancialPlacement(deps: RegistryDeps, actor: Actor, id: string, input: Row, key: unknown) {
  const versionId = content(input.financial_version_id).toLowerCase(), channel = content(input.channel);
  const evidence = content(input.evidence, "доказательство размещения"), reason = content(input.reason, "причину записи");
  const placedAt = typeof input.placed_at === "string" ? new Date(input.placed_at) : new Date(NaN);
  if (!Number.isFinite(placedAt.getTime()) || placedAt.getTime() > Date.now()) invalid("Укажите действительную прошедшую дату размещения");
  const proofId = input.proof_version_id == null ? null : content(input.proof_version_id).toLowerCase();
  return deps.db.transaction(exec => idempotent(exec, actor, `financial.placement.record:${id}`, key, input, async () => {
    const initial = await requireFinancialObligation(exec, actor, id, true);
    if (!initial.publication_id) invalid("Сначала выпустите финансовый комплект");
    // Порядок совпадает с выпуском: публикация → версия → документы → обязанность.
    const [publication] = await exec.query<{ financial_version_id: string | null }>("select financial_version_id from publication where id=$1 for update", [initial.publication_id]);
    const [version] = await exec.query<{ id: string; published_at: string | null }>("select id,published_at from financial_publication_version where id=$1 and obligation_id=$2 for update", [versionId, id]);
    if (!version?.published_at) invalid("Подтверждение относится к выпущенной версии этой обязанности");
    const snapshot = jsonValue<{ definition: FinancialRule }>(initial.rule_snapshot);
    if (!snapshot.definition.channels.includes(channel)) invalid("Канал не предусмотрен исходным регламентом");
    const parts = await exec.query<{ document_version_id: string }>("select document_version_id from financial_package_document where financial_version_id=$1", [version.id]);
    const currentHead = publication?.financial_version_id === version.id;
    const ids = [...new Set([...(currentHead ? parts.map(p => p.document_version_id) : []), ...(proofId ? [proofId] : [])])];
    // Единая сортировка блокировок, включая отдельный документ-доказательство.
    if (ids.length) await exec.query("select id from document where id in (select document_id from document_version where id=any($1::uuid[])) order by id for update", [ids]);
    let valid = false;
    if (currentHead) {
      try { await checkedDocumentVersions(exec, actor, parts.map(p => p.document_version_id), initial.building_ids); valid = true; }
      catch (error) {
        if (!(error instanceof ApiError) || !["VALIDATION_FAILED", "NOT_FOUND", "FORBIDDEN"].includes(error.code)) throw error;
      }
    }
    if (proofId) await checkedDocumentVersions(exec, actor, [proofId], initial.building_ids);
    const row = await requireFinancialObligation(exec, actor, id, true, true);
    checkVersion(row.version, input.expected_version);
    await exec.query(`insert into financial_placement(obligation_id,financial_version_id,channel,placed_at,evidence,proof_version_id,reason,actor_person_id)
      values($1,$2,$3,$4,$5,$6,$7,$8)`, [id, version.id, channel, placedAt.toISOString(), evidence, proofId, reason, actor.person.id]);
    const placements = await exec.query<{ financial_version_id: string; channel: string }>("select financial_version_id,channel from financial_placement where obligation_id=$1 and financial_version_id=$2", [id, version.id]);
    const current = publication?.financial_version_id === version.id && row.active_version_id === version.id;
    const complete = current && valid && missingFinancialPlacements(snapshot.definition.channels, version.id, placements).length === 0;
    const [updated] = await exec.query<typeof row>("update financial_obligation set completed_at=case when $2 then coalesce(completed_at,now()) when $3 then null else completed_at end,version=version+1 where id=$1 returning *", [id, complete, current]);
    if (!updated) throw new ApiError("NOT_FOUND");
    await recordAudit(deps, exec, actor, "financial.placement.record", "financial_obligation", id, row.building_ids,
      { version: row.version }, { version: updated.version, financial_version_id: version.id, channel, completed: complete }, reason);
    return updated;
  }, () => requireFinancialObligation(exec, actor, id, true)));
}
