import { requireTask, taskResource } from "../tasks/access.ts";
import { documentResource, requireDocument } from "../documents/access.ts";
import { checkVersion } from "./fsm.ts";
import { can } from "../../pdp/evaluate.ts";
import { ApiError } from "../../errors/api.ts";
import type { Actor } from "../../pdp/types.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { invalid, type Row } from "../registry/validation.ts";
import { requireRequest } from "./access.ts";
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const FILE_TYPES: Record<string, string[]> = {
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  png: ["image/png"],
  webp: ["image/webp"],
  heic: ["image/heic", "image/heif"],
  mp4: ["video/mp4"],
  mov: ["video/quicktime"],
  webm: ["video/webm"],
  pdf: ["application/pdf"],
  zip: ["application/zip", "application/x-zip-compressed"],
  "7z": ["application/x-7z-compressed"],
  rar: ["application/vnd.rar", "application/x-rar-compressed"],
  doc: ["application/msword"],
  xls: ["application/vnd.ms-excel"],
  ppt: ["application/vnd.ms-powerpoint"],
  docx: [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  pptx: [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ],
  odt: ["application/vnd.oasis.opendocument.text"],
  ods: ["application/vnd.oasis.opendocument.spreadsheet"],
  odp: ["application/vnd.oasis.opendocument.presentation"],
};
export function validateFile(
  filename: unknown,
  size: unknown,
  mime: unknown,
): { filename: string; size: number; mime: string } {
  if (
    typeof filename !== "string" || filename.length > 200 ||
    /[\\/\x00-\x1f]/.test(filename)
  ) invalid("Некорректное имя файла");
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (
    !Number.isSafeInteger(size) || Number(size) < 1 ||
    Number(size) > MAX_FILE_BYTES || typeof mime !== "string" ||
    !FILE_TYPES[ext]?.includes(mime)
  ) {
    throw new ApiError(
      "FILE_LIMIT",
      "Допустим файл согласованного формата до 20 МиБ",
    );
  }
  return { filename, size: Number(size), mime };
}
export interface FileStorage {
  put(
    bucket: string,
    path: string,
    bytes: Uint8Array,
    mime: string,
  ): Promise<void>;
  info(bucket: string, path: string): Promise<{ size: number; mime: string }>;
  sign(bucket: string, path: string, seconds: number): Promise<string>;
}
export class SupabaseFileStorage implements FileStorage {
  constructor(private url: string, private key: string) {}
  private async call(
    path: string,
    method: string,
    body?: BodyInit,
    mime = "application/json",
  ): Promise<Response> {
    const response = await fetch(`${this.url}/storage/v1${path}`, {
      method,
      signal: AbortSignal.timeout(10000),
      headers: {
        authorization: `Bearer ${this.key}`,
        apikey: this.key,
        "content-type": mime,
      },
      body,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new ApiError(
        "VALIDATION_FAILED",
        "Хранилище не подтвердило файл. Вложение остаётся неполным; повторите загрузку.",
      );
    }
    return response;
  }
  async put(
    bucket: string,
    path: string,
    bytes: Uint8Array,
    mime: string,
  ): Promise<void> {
    await (await this.call(
      `/object/files-${bucket}/${path}`,
      "POST",
      new Blob([bytes as BlobPart], { type: mime }),
      mime,
    )).body?.cancel();
  }
  async info(
    bucket: string,
    path: string,
  ): Promise<{ size: number; mime: string }> {
    const data =
      await (await this.call(`/object/info/files-${bucket}/${path}`, "GET"))
        .json();
    return {
      size: Number(data.metadata?.size ?? data.size),
      mime: String(
        data.metadata?.mimetype ?? data.content_type ?? data.contentType,
      ),
    };
  }
  async sign(bucket: string, path: string, seconds: number): Promise<string> {
    const data = await (await this.call(
      `/object/sign/files-${bucket}/${path}`,
      "POST",
      JSON.stringify({ expiresIn: seconds }),
    )).json();
    return `${this.url}/storage/v1${data.signedURL}`;
  }
}
export async function prepareFile(
  deps: RegistryDeps,
  actor: Actor,
  input: Row,
): Promise<Row> {
  return deps.db.transaction(async (exec) => {
    const ownerType = input.owner_type ?? "request";
    if (
      !["request", "message", "task", "document"].includes(String(ownerType)) ||
      typeof input.owner_id !== "string"
    ) invalid("Некорректный владелец вложения");
    const requestId = input.owner_id;
    if (ownerType === "message") {
      // Отправленные сообщения неизменяемы: материалы добавляются следующим сообщением.
      invalid("Загрузите файл для обращения и приложите к новому сообщению");
    }
    const document = ownerType === "document" ? await requireDocument(exec, actor, requestId, "document.prepare", true) : null;
    const documentBucket = document && ["resident", "owner"].includes(document.audience) ? "resident" : "internal";
    const bucket = input.bucket ?? (document ? documentBucket : ownerType === "task" ? "internal" : "resident");
    if (!["resident", "internal"].includes(String(bucket))) {
      throw new ApiError("FORBIDDEN");
    }
    if (document) {
      checkVersion(document.version, input.expected_version);
      if (bucket !== documentBucket) throw new ApiError("FORBIDDEN");
    } else if (ownerType === "task") {
      const task = await requireTask(exec, actor, requestId, "task.execute", true);
      if (task.state !== "in_progress" || bucket !== "internal") throw new ApiError("INVALID_TRANSITION", "Файлы отчёта доступны при выполнении задания");
    } else {
      const row = await requireRequest(
        exec,
        actor,
        requestId,
        "request.read",
        true,
      );
      if (row.state === "draft") {
        if (row.author_person_id !== actor.person.id || bucket !== "resident") {
          throw new ApiError("FORBIDDEN");
        }
      } else {await requireRequest(
          exec,
          actor,
          requestId,
          bucket === "internal" ? "request.internal" : "request.comment",
        );}
    }
    const extension = typeof input.filename === "string"
      ? input.filename.split(".").pop()!.toLowerCase()
      : "";
    const f = validateFile(
      input.filename,
      input.size ?? input.size_bytes,
      input.mime || FILE_TYPES[extension]?.[0],
    );
    const [policy] = await exec.query<
      { max_bytes: number; max_per_message: number; extensions: string[] }
    >("select * from file_policy where singleton");
    if (
      !policy || f.size > policy.max_bytes ||
      !policy.extensions.includes(extension)
    ) throw new ApiError("FILE_LIMIT", "Файл не соответствует настройкам ОСИ");
    const [count] = await exec.query<{ n: string }>(
      `select count(*)::text n from attachment a where owner_id=$1 and owner_type=$4 and task_report_id is null and uploaded_by=$2 and bucket=$3
       and ($4<>'document' or not exists(select 1 from document_version v where v.attachment_id=a.id or v.signed_attachment_id=a.id))`,
      [requestId, actor.person.id, bucket, ownerType],
    );
    if (Number(count!.n) >= policy.max_per_message) {
      throw new ApiError(
        "FILE_LIMIT",
        "К одному сообщению до 10 файлов. Отправьте принятые вложения следующим сообщением.",
      );
    }
    const id = crypto.randomUUID();
    await exec.query(
      "insert into attachment(id,request_id,task_id,owner_type,owner_id,bucket,storage_path,filename,size_bytes,mime,uploaded_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [id,ownerType === "task" || document ? null : requestId,ownerType === "task" ? requestId : null,ownerType,requestId,bucket,
        `${requestId}/${id}`,f.filename,f.size,f.mime,actor.person.id],
    );
    return {
      attachment_id: id,
      upload_path: `/v1/files/${id}/upload`,
      expires_in: 300,
      status: "incomplete",
    };
  });
}
async function fileAccess(
  deps: RegistryDeps,
  actor: Actor,
  id: string,
  write = false,
): Promise<Row> {
  const [a] = await deps.db.query<Row>("select * from attachment where id=$1", [
    id,
  ]);
  if (!a) throw new ApiError("NOT_FOUND");
  if (a.owner_type === "document") {
    const doc = await requireDocument(deps.db, actor, String(a.owner_id), write ? "document.prepare" : "document.read");
    const versions = await deps.db.query<{ was_published: boolean; state: string }>("select was_published,state from document_version where document_id=$1 and (attachment_id=$2 or signed_attachment_id=$2)", [doc.id, id]);
    if (write && (versions.length || a.uploaded_by !== actor.person.id)) throw new ApiError("FORBIDDEN");
    if (!write) {
      const r = await documentResource(deps.db, actor, doc);
      const internal = can(actor, "document.prepare", r).allow || can(actor, "document.review", r).allow || can(actor, "document.manage", r).allow;
      if (!internal && !versions.some(v => v.was_published || (r.documentAccess?.assignedTask && v.state === "approved"))) throw new ApiError("NOT_FOUND");
    }
    return a;
  }
  if (a.owner_type === "task") {
    const task = await requireTask(deps.db,actor,String(a.task_id),write ? "task.execute" : "task.read");
    if (write && (task.state !== "in_progress" || a.task_report_id || a.uploaded_by !== actor.person.id)) throw new ApiError("FORBIDDEN");
    if(!write && a.uploaded_by!==actor.person.id){
      const published=a.task_report_id || (await deps.db.query("select id from task_log where task_id=$1 and meta->>'action'='found_problem' and (meta->'attachment_ids') ? $2::text",[a.task_id,id])).length>0;
      if(!published||!can(actor,"task.manage",taskResource(task)).allow)throw new ApiError("NOT_FOUND");
    }
    return a;
  }

  await requireRequest(
    deps.db,
    actor,
    String(a.request_id),
    a.bucket === "internal" ? "request.internal" : "request.read",
  );
  if (a.owner_type === "request" && a.uploaded_by !== actor.person.id) {
    throw new ApiError("NOT_FOUND");
  }
  if (write) {
    if (a.uploaded_by !== actor.person.id) throw new ApiError("FORBIDDEN");
    const row = await requireRequest(deps.db, actor, String(a.request_id));
    if (row.state !== "draft") {
      await requireRequest(
        deps.db,
        actor,
        row.id,
        a.bucket === "internal" ? "request.internal" : "request.comment",
      );
    }
  }
  if (a.owner_type === "message") {
    const [message] = await deps.db.query(
      "select id from message where id=$1 and restricted_at is null",
      [a.owner_id],
    );
    if (!message) throw new ApiError("NOT_FOUND");
  }
  return a;
}
export function verifyFileHeader(filename: string, bytes: Uint8Array): void {
  const ext = filename.split(".").pop()!.toLowerCase();
  const hex = Array.from(bytes.slice(0, 12)).map((n) =>
    n.toString(16).padStart(2, "0")
  ).join("");
  const ascii = new TextDecoder().decode(bytes.slice(0, 16));
  const valid = ext === "pdf"
    ? ascii.startsWith("%PDF")
    : ["jpg", "jpeg"].includes(ext)
    ? hex.startsWith("ffd8ff")
    : ext === "png"
    ? hex.startsWith("89504e470d0a1a0a")
    : ext === "webp"
    ? ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP"
    : ext === "webm"
    ? hex.startsWith("1a45dfa3")
    : ["mp4", "mov", "heic"].includes(ext)
    ? ascii.slice(4, 8) === "ftyp"
    : ext === "7z"
    ? hex.startsWith("377abcaf271c")
    : ext === "rar"
    ? hex.startsWith("526172211a07")
    : ["doc", "xls", "ppt"].includes(ext)
    ? hex.startsWith("d0cf11e0a1b11ae1")
    : hex.startsWith("504b0304");
  if (!valid) {
    throw new ApiError(
      "FILE_LIMIT",
      "Содержимое файла не соответствует формату",
    );
  }
}
export async function uploadFile(
  deps: RegistryDeps,
  storage: FileStorage,
  actor: Actor,
  id: string,
  bytes: Uint8Array,
): Promise<Row> {
  const a = await fileAccess(deps, actor, id, true);
  if (a.status !== "incomplete") {
    throw new ApiError("INVALID_TRANSITION", "Сохранённый файл неизменяем");
  }
  if (Date.now() > new Date(String(a.upload_expires_at)).getTime()) {
    throw new ApiError(
      "INVALID_TRANSITION",
      "Срок загрузки истёк: запросите новую загрузку",
    );
  }
  if (bytes.byteLength !== a.size_bytes || bytes.byteLength > MAX_FILE_BYTES) {
    throw new ApiError("FILE_LIMIT", "Размер не совпадает с заявленным");
  }
  verifyFileHeader(String(a.filename), bytes);
  await storage.put(
    String(a.bucket),
    String(a.storage_path),
    bytes,
    String(a.mime),
  );
  return { attachment_id: id, status: "incomplete" };
}
export async function completeFile(
  deps: RegistryDeps,
  storage: FileStorage,
  actor: Actor,
  id: string,
): Promise<Row> {
  const a = await fileAccess(deps, actor, id, true);
  const info = await storage.info(String(a.bucket), String(a.storage_path));
  if (info.size !== a.size_bytes || info.mime !== a.mime) {
    throw new ApiError(
      "FILE_LIMIT",
      "Хранилище вернуло другой размер или формат",
    );
  }
  await deps.db.query("update attachment set status='complete' where id=$1", [
    id,
  ]);
  return { attachment_id: id, status: "complete" };
}
export async function fileUrl(
  deps: RegistryDeps,
  storage: FileStorage,
  actor: Actor,
  id: string,
): Promise<Row> {
  const a = await fileAccess(deps, actor, id);
  if (a.status !== "complete") {
    throw new ApiError("INVALID_TRANSITION", "Файл ещё не сохранён");
  }
  return {
    url: await storage.sign(String(a.bucket), String(a.storage_path), 300),
    expires_in: 300,
  };
}

export async function retryFile(
  deps: RegistryDeps,
  actor: Actor,
  id: string,
): Promise<Row> {
  const a = await fileAccess(deps, actor, id, true);
  if (a.status !== "incomplete") throw new ApiError("INVALID_TRANSITION");
  await deps.db.query(
    "update attachment set upload_expires_at=now()+interval '5 minutes' where id=$1",
    [id],
  );
  return {
    attachment_id: id,
    upload_path: `/v1/files/${id}/upload`,
    expires_in: 300,
  };
}
