import type { TemplateDef } from "./types.ts";
export const request_filesTemplates: readonly TemplateDef[] = [
  {
    "key": "requests.otkroyte_zadanie_task_nomer_zatem_otpravte_fayl",
    "section": "requests",
    "title": "Откройте задание: /task НОМЕР, затем отправьте файл.",
    "description": "Реплика request-files",
    "variables": [],
    "ru": "Откройте задание: /task НОМЕР, затем отправьте файл.",
    "kk": "Тапсырманы ашыңыз: /task НӨМІР, сонан кейін файлды жіберіңіз.",
  },
  {
    "key":
      "requests.snachala_sozdayte_ili_otkroyte_obraschenie_newrequest_request",
    "section": "requests",
    "title":
      "Сначала создайте или откройте обращение: /newrequest, /request НОМЕР.",
    "description": "Реплика request-files",
    "variables": [],
    "ru":
      "Сначала создайте или откройте обращение: /newrequest, /request НОМЕР.",
    "kk": "Алдымен өтінішті ашыңыз: /newrequest, /request НӨМІР.",
  },
  {
    "key": "requests.etot_vid_fayla_ne_podderzhivaetsya_otpravte_dokumentom",
    "section": "requests",
    "title": "Этот вид файла не поддерживается. Отправьте документом.",
    "description": "Реплика request-files",
    "variables": [],
    "ru": "Этот вид файла не поддерживается. Отправьте документом.",
    "kk": "Бұл файл түріне қолдау жоқ. Құжат ретінде жіберіңіз.",
  },
  {
    "key": "requests.fayl_zadaniya_prinyat_v_ochered_dozhdites_soobscheniya",
    "section": "requests",
    "title":
      "Файл задания принят в очередь. Дождитесь сообщения о сохранении, затем /taskfiles.",
    "description": "Реплика request-files",
    "variables": [],
    "ru":
      "Файл задания принят в очередь. Дождитесь сообщения о сохранении, затем /taskfiles.",
    "kk":
      "Файл кезекте. Сақталғаны туралы хабарламаны күтіңіз, содан кейін /taskfiles.",
  },
  {
    "key": "requests.fayl_prinyat_v_ochered_poka_ne_sohranen",
    "section": "requests",
    "title":
      "Файл принят в очередь, пока не сохранён. Обращение можно отправить независимо: /sendrequest.",
    "description": "Реплика request-files",
    "variables": [],
    "ru":
      "Файл принят в очередь, пока не сохранён. Обращение можно отправить независимо: /sendrequest.",
    "kk":
      "Файл кезекте, әлі сақталмады. Өтінішті /sendrequest арқылы жібере аласыз.",
  },
];
