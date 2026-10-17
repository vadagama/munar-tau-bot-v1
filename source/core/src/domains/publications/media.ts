import type { Actor } from "../../pdp/types.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { invalid, type Row } from "../registry/validation.ts";
import { ApiError } from "../../errors/api.ts";
import type { FileStorage } from "../requests/files.ts";
import { idempotent } from "../requests/service.ts";
import { requireCommon } from "../tasks/common.ts";
import {
  type Publication,
  publicationLog,
  requirePublication,
} from "./service.ts";
import { checkVersion } from "../requests/fsm.ts";
export async function selectMedia(
  deps: RegistryDeps,
  actor: Actor,
  id: string,
  input: Row,
  key: unknown,
) {
  return deps.db.transaction((exec) =>
    idempotent(exec, actor, `publication.media:${id}`, key, input, async () => {
      const { row, scope } = await requirePublication(
        exec,
        actor,
        id,
        "publication.manage",
        true,
      );
      checkVersion(row.version, input.expected_version);
      if (
        row.state !== "draft" || row.kind !== "work_report" ||
        !row.common_work_id
      ) invalid("Медиа выбираются в черновике отчёта о работе");
      const ids = input.attachment_ids;
      if (
        !Array.isArray(ids) || ids.length > 10 || ids.some((i) =>
          typeof i !== "string"
        ) || new Set(ids).size !== ids.length || input.privacy_checked !== true
      ) invalid("Выберите до 10 файлов и подтвердите проверку приватности");
      const work = await requireCommon(exec, actor, row.common_work_id, true);
      if (work.state !== "completed") invalid("Работа ещё не принята");
      const files = await exec.query(
        "select a.id from attachment a join task t on t.id=a.task_id where a.id=any($1::uuid[]) and a.status='complete' and a.task_report_id=(select r.id from task_report r where r.task_id=t.id order by r.version desc limit 1) and t.state='accepted_admin' and t.common_work_id=$2 and (a.mime like 'image/%' or a.mime like 'video/%')",
        [ids, row.common_work_id],
      );
      if (files.length !== ids.length) {
        invalid("Выбраны не принятые фото/видео этой общей работы");
      }
      await exec.query(
        "delete from publication_attachment where publication_id=$1",
        [id],
      );
      for (const file of ids) {
        await exec.query(
          "insert into publication_attachment(publication_id,attachment_id,selected_by) values($1,$2,$3)",
          [id, file, actor.person.id],
        );
      }
      const [updated] = await exec.query<Publication>(
        "update publication set version=version+1,approved_by=null,approval_note=null where id=$1 returning *",
        [id],
      );
      await publicationLog(
        deps,
        exec,
        actor,
        updated!,
        scope.map((s) => s.building_id),
        "media_selected",
      );
      return updated!;
    }, () => requirePublication(exec, actor, id, "publication.manage"))
  );
}
export async function publicationFile(
  deps: RegistryDeps,
  storage: FileStorage,
  actor: Actor,
  id: string,
  fileId: string,
) {
  await requirePublication(deps.db, actor, id);
  const [file] = await deps.db.query<Row>(
    "select a.* from publication_attachment p join attachment a on a.id=p.attachment_id where p.publication_id=$1 and p.attachment_id=$2 and a.status='complete'",
    [id, fileId],
  );
  if (!file) throw new ApiError("NOT_FOUND");
  return {
    url: await storage.sign(
      String(file.bucket),
      String(file.storage_path),
      300,
    ),
    expires_in: 300,
  };
}
