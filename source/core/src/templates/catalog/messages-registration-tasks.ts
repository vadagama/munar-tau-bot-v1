import { premiseLabels, roleLabels } from "../../locales/registry.ts";
import type {
  MessageButton,
  MessageExample,
  TemplateDef,
  TemplateVar,
} from "./types.ts";
import { registrationTemplates } from "./registration.ts";
import { tasksTemplates } from "./tasks.ts";
import { helpTemplates } from "./help.ts";
import { TASK_STATE_TEXT, TASK_ACTIVE_WORK_STATES } from "../../locales/tasks.ts";
import { commonTemplates } from "./common.ts";
const originals = [
  ...registrationTemplates,
  ...tasksTemplates,
  ...commonTemplates,
  ...helpTemplates,
];
const old = (key: string, lang: "ru" | "kk") =>
  originals.find((d) => d.key === key)![lang];
const consentButtons: MessageButton[] = [
  { id: "confirm", ru: "Согласен (да)", kk: "Келісемін (иә)" },
  { id: "cancel", ru: "Отменить", kk: "Болдырмау" },
];
const taskButtons: MessageButton[] = [
  { id: "accept", ru: "Принять", kk: "Қабылдау" },
  { id: "start", ru: "Начать работу", kk: "Жұмысты бастау" },
  { id: "resume", ru: "Возобновить", kk: "Жалғастыру" },
  { id: "continue", ru: "Продолжить", kk: "Жалғастыру" },
  { id: "report", ru: "Заполнить отчёт", kk: "Есеп толтыру" },
  { id:"decline",ru:"Не могу выполнить",kk:"Орындай алмаймын" },
  { id:"pause",ru:"Запросить остановку",kk:"Тоқтатуды сұрау" },
  { id:"problem",ru:"Сообщить о проблеме",kk:"Мәселе туралы хабарлау" },
  { id:"files",ru:"Файлы",kk:"Файлдар" },
  { id:"visits",ru:"Визиты",kk:"Келулер" },
  {id:"emergency",ru:"Аварийная служба",kk:"Апаттық қызмет"},
];
const values: Record<string, [string, string]> = {
  registered_at: ["Дата регистрации (Алматы)", "21.10.2026 10:00"],
  registrations: [
    "Анкеты с состоянием, именем, помещением и причиной",
    "1. Ожидает проверки: Алия, Квартира 1/4, Собственник",
  ],
  accesses: ["Список выданных доступов", "1. Алия: Квартира 4"],
  premises: [
    "Список помещений и связей жителя",
    "1. Квартира 1/4 — Собственник",
  ],
  phase: ["Очередь строительства", "1"],
  buildings: ["Список доступных зданий", "1. Дом 1"],
  kinds: [
    "Типы помещений",
    "1. Квартира\n2. Коммерческое помещение\n3. Парковочное место\n4. Кладовка",
  ],
  roles: [
    "Доступные роли",
    "1. Собственник\n2. Арендатор\n3. Проживающий\n4. Другое",
  ],
  invite_command: ["Команда принятия приглашения", "/start invite_example"],
  expires_at: ["Срок действия приглашения", "25.10.2026 12:00"],
  reason: ["Вопрос администратора", "Уточните имя"],
  full_name: ["Имя и фамилия", "Алия Омарова"],
  phone: ["Телефон", "+77001234567"],
  kind: ["Тип помещения", "Квартира"],
  code: ["Код здания", "1"],
  number: ["Номер помещения или задания", "4"],
  index: ["Номер анкеты в списке", "1"],
  role: ["Роль жителя", "Собственник"],
  tasks: [
    "Список заданий: кликабельный номер, название, состояние",
    "З-26-1 · Проверить освещение\nВыполняется",
  ],
  title: ["Название задания", "Проверить освещение"],
  state: ["Состояние задания", "В работе"],
  instruction: ["Инструкция исполнителю", "Проверьте светильники в подъезде"],
  methodology_version: ["Версия методички", "2"],
  methodology_date: ["Дата методички", "18.10.2026"],
  visits: [
    "Согласованные визиты (пусто, если их нет)",
    "Визит: 20.10.2026 10:00–12:00 — Согласован\n",
  ],
  due_at: ["Срок задания", "21.10.2026 12:00"],
  actions: [
    "Доступные действия по текущему состоянию задания",
    "\n/reporttask — заполнить отчёт",
  ],
  files: ["Список файлов и состояния сохранения", "1. photo.jpg: сохранён"],
  number_report_index_1: ["Номер доказательства", "1"],
  requirements_length: ["Количество доказательств", "2"],
};
function variables(ru: string, kk: string): TemplateVar[] {
  return [
    ...new Set(
      [
        ...ru.matchAll(/\{([a-z][a-z0-9_]*)\}/g),
        ...kk.matchAll(/\{([a-z][a-z0-9_]*)\}/g),
      ].map((m) => m[1]!),
    ),
  ].map((name) => ({
    name,
    description: values[name]?.[0] ?? name,
    example: values[name]?.[1] ?? "Пример",
  }));
}
function scenarioFor(command: string): string {
  const names: Record<string, string> = {
    "/register": "Регистрация — новая анкета",
    "/fix": "Регистрация — исправление анкеты",
    "/add": "Добавление помещения",
    "/status": "Статус регистрации",
    "/pending": "Подтверждение анкет собственником",
    "/accesses": "Выданные доступы",
    "/objects": "Мои помещения",
    "/invite": "Приглашение жителя",
    "/start invite_*": "Регистрация по приглашению",
    "/delete": "Удаление данных",
    "/tasks": "Список заданий",
    "/task": "Карточка задания",
    "/reporttask": "Заполнение отчёта",
    "/submitreport": "Отправка отчёта",
    "/taskfiles": "Файлы задания",
    "/proposevisit": "Предложение визита",
    "/noaccess": "Нет доступа на объект",
    "/problem": "Найденная проблема",
  };
  return names[command] ?? "Изменение состояния задания";
}
function def(
  key: string,
  title: string,
  command: string,
  legacyKeys: string[],
  make: (lang: "ru" | "kk") => string,
  buttons?: MessageButton[],
): TemplateDef {
  const ru = make("ru"), kk = make("kk"), vars = variables(ru, kk);
  const sample = Object.fromEntries(vars.map((v) => [v.name, v.example]));
  if ("registrations" in sample) {
    sample.registrations = key.endsWith("pending")
      ? "1. <b>Алия Омарова</b>, +77001234567; Квартира 4"
      : key.endsWith("fix_select")
      ? "1. <b>Нужно уточнение</b> — Уточните имя"
      : key === "message.registration.status"
      ? "<b>Ожидает проверки</b>: Алия Омарова, Квартира 1/4, Собственник"
      : key === "message.registration.status_history"
      ? "22.10.2026 18:30 — <b>Отказано</b>: Алия Омарова, Квартира 1/4, Собственник — Неправильный номер"
      : "1. <b>Ожидает проверки</b>: Алия Омарова, Квартира 1/4, Собственник";
  }
  if ("tasks" in sample) {
    sample.tasks = "З-26-1 · Проверить освещение\nВыполняется";
  }
  if ("accesses" in sample) {
    sample.accesses = "1. <b>Алия Омарова</b>: Квартира 4";
  }
  const blocks = ["registrations", "tasks", "accesses", "buildings"].filter((name) =>
    name in sample
  );
  const sampleKk = { ...sample };
  if ("registrations" in sampleKk) {
    sampleKk.registrations = key.endsWith("pending")
      ? "1. <b>Алия Омарова</b>, +77001234567; Пәтер 4"
      : key.endsWith("fix_select")
      ? "1. <b>Нақтылау қажет</b> — Атыңызды нақтылаңыз"
      : key === "message.registration.status"
      ? "<b>Тексерілуде</b>: Алия Омарова, Пәтер 1/4, Меншік иесі"
      : key === "message.registration.status_history"
      ? "22.10.2026 18:30 — <b>Бас тартылды</b>: Алия Омарова, Пәтер 1/4, Меншік иесі — Дұрыс емес нөмір"
      : "1. <b>Тексерілуде</b>: Алия Омарова, Пәтер 1/4, Меншік иесі";
  }
  if ("tasks" in sampleKk) {
    sampleKk.tasks = "З-26-1 · Жарықты тексеру\nОрындалуда";
  }
  if ("accesses" in sampleKk) {
    sampleKk.accesses = "1. <b>Алия Омарова</b>: Пәтер 4";
  }
  if (key === "message.registration.building_unknown") {
    const link = '<a href="https://t.me/munar_tau_bot?start=house_00000000-0000-4000-8000-000000000001_123456abcdef">102/1</a>';
    sample.buildings = "<b>Очередь 1</b>\n" + link;
    sampleKk.buildings = "<b>1-кезек</b>\n" + link;
  }
  let buttonRows: MessageExample["buttons"] = buttons?.length
    ? [
      buttons.map((b) => ({
        id: b.id,
        vars: Object.fromEntries(
          (b.variables ?? []).map((v) => [v.name, v.example]),
        ),
      })),
    ]
    : [];
  if (["already_registered", "already_applied", "already_registered_without_premises"].some(name => key === "message.registration." + name)) {
    buttonRows = buttons?.map(button => [{ id: button.id }]) ?? [];
  }
  if (key === "message.registration.add_select") {
    buttonRows = [[{ id: "premise", vars: { code: "1", number: "4" } }], [{
      id: "manual",
    }]];
    sampleKk.premises = "1. Пәтер 1/4 — Меншік иесі";
  }
  const optionConfig = key === "message.registration.kind"
    ? {
      name: "kinds",
      id: "kind",
      options: ["apartment", "commercial", "parking_slot", "storage"],
      labels: premiseLabels,
    }
    : key === "message.registration.role"
    ? {
      name: "roles",
      id: "role",
      options: ["owner", "tenant", "resident", "other"],
      labels: roleLabels,
    }
    : undefined;
  if (optionConfig) {
    const { name, id, options, labels } = optionConfig;
    if (vars.some(v => v.name === name)) sample[name] = options.map((option, i) => `${i + 1}. ${labels[option]!.ru}`)
      .join("\n");
    if (vars.some(v => v.name === name)) sampleKk[name] = options.map((option, i) =>
      `${i + 1}. ${labels[option]!.kk}`
    ).join("\n");
    buttonRows = options.map(
      (option) => [{
        id,
        vars_ru: { label: labels[option]!.ru },
        vars_kk: { label: labels[option]!.kk },
      }],
    );
  }
  return {
    key,
    section: key.startsWith("message.tasks") ? "tasks" : "registration",
    title,
    command,
    scenario: scenarioFor(command),
    description: `Полное сообщение: ${title}`,
    ru,
    kk,
    variables: vars,
    legacyKeys,
    buttons,
    examples: [{
      id: "default",
      title: "Пример сообщения",
      ru: sample,
      kk: sampleKk,
      blocks,
      buttons: buttonRows,
    }],
  };
}
const R = "registration.";
const defs: TemplateDef[] = [
  def(
    "message.registration.status",
    "Статус регистрации",
    "/status",
    [R + "ispravit_anketu_posle_utochneniya"],
    (l) =>
      l === "kk"
        ? "Өтінім күйі:\n{registrations}"
        : "Статус анкеты:\n{registrations}",
    [{ id: "edit", ru: "Исправить анкету", kk: "Өтінімді түзету" }, { id: "delete", ru: "Удалить анкету", kk: "Өтінімді жою" }],
  ),
  def(
    "message.registration.status_history",
    "История изменений статуса анкеты",
    "/status",
    [],
    (l) =>
      l === "kk"
        ? "Өтінім күйінің өзгеру тарихы:\n{registrations}"
        : "История изменений статуса:\n{registrations}",
  ),
  def(
    "message.registration.pending",
    "Анкеты на подтверждение собственнику",
    "/pending",
    [R + "dlya_otkaza", R + "dlya_spora"],
    (l) =>
      l === "kk"
        ? "Растауға өтінімдер:\n{registrations}"
        : "Анкеты на подтверждение:\n{registrations}",
    [{
      id: "approve",
      ru: "Подтвердить — {index}",
      kk: "Растау — {index}",
      variables: variables("{index}", ""),
    }, {
      id: "reject",
      ru: "Отказать — {index}",
      kk: "Бас тарту — {index}",
      variables: variables("{index}", ""),
    }, {
      id: "dispute",
      ru: "Спор — {index}",
      kk: "Дау — {index}",
      variables: variables("{index}", ""),
    }],
  ),
  def(
    "message.registration.reason_prompt",
    "Решение — причина отказа, спора или отзыва",
    "/pending",
    [],
    (l) =>
      l === "kk"
        ? "Себебін бір хабарламада көрсетіңіз."
        : "Укажите причину одним сообщением.",
    [{ id: "cancel", ru: "Отменить", kk: "Болдырмау" }],
  ),
  def(
    "message.registration.accesses",
    "Выданные доступы",
    "/accesses",
    [R + "prekratit_dostup", R + "spor_po_ankete"],
    (l) =>
      l === "kk"
        ? "Берілген қолжетімділіктер:\n{accesses}"
        : "Выданные доступы:\n{accesses}",
    [{
      id: "revoke",
      ru: "Прекратить доступ — {index}",
      kk: "Қолжетімділікті тоқтату — {index}",
      variables: variables("{index}", ""),
    }, {
      id: "dispute",
      ru: "Спор — {index}",
      kk: "Өтінім бойынша дау — {index}",
      variables: variables("{index}", ""),
    }],
  ),
  def(
    "message.registration.objects",
    "Мои помещения",
    "/objects",
    [R + "priglasit_zhiltsa_arendator_prozhivayuschiy_ili_drugoe"],
    (l) =>
      l === "kk"
        ? "Менің үй-жайларым:\n{premises}"
        : "Мои помещения:\n{premises}",
    [{
      id: "invite",
      ru: "Пригласить жильца",
      kk: "Тұрғынды шақыру",
    }, {
      id: "invite_premise",
      ru: "Пригласить — {code}/{number}",
      kk: "Шақыру — {code}/{number}",
      variables: variables("{code}/{number}", ""),
    }],
  ),
  def(
    "message.registration.invite",
    "Приглашение создано",
    "/invite",
    [R + "priglashenie", R + "deystvuet_do"],
    (l) =>
      old(R + "priglashenie", l) + ": {invite_command}\n" +
      old(R + "deystvuet_do", l) + ": {expires_at}",
  ),
  def(
    "message.registration.add_select",
    "Добавление помещения — выбор из реестра",
    "/add",
    [R + "v_reestre_osi_naydeny_pomescheniya_svyazannye_s"],
    (l) =>
      old(R + "v_reestre_osi_naydeny_pomescheniya_svyazannye_s", l) +
      "\n{premises}",
    [{
      id: "premise",
      ru: "{code}/{number}",
      kk: "{code}/{number}",
      variables: variables("{code}/{number}", ""),
    }, { id: "manual", ru: "Ввести вручную", kk: "Қолмен енгізу" }],
  ),
  ...["already_registered", "already_applied", "already_registered_without_premises"].map((name) =>
    def(
      "message.registration." + name,
      name.startsWith("already_registered")
        ? "Повторная регистрация — доступ подтверждён"
        : "Повторная регистрация — анкета в работе",
      "/register",
      name === "already_registered_without_premises" ? [] : [
        R + name,
        R + "status_anket",
        R + "ispravit_anketu",
        R + "dobavit_esche_obekt",
      ],
      (l) => name === "already_registered_without_premises"
        ? l === "kk"
          ? "{full_name}, Сіз {registered_at} күні тіркелдіңіз, сауалнамаға үй-жайлар әлі байланыстырылмаған.\nҚайта тіркелудің қажеті жоқ."
          : "{full_name}, Вы зарегистрированы {registered_at}, помещения пока не прикреплены к анкете.\nПовторная регистрация не нужна."
        : old(R + name, l) + "\n{registrations}",
      [{
        id: "status",
        ru: "Статус регистрации",
        kk: "Тіркелу күйі",
      }, {
        id: "fix",
        ru: "Исправить анкету",
        kk: "Өтінімді түзету",
      }, {
        id: "add",
        ru: "Добавить помещение",
        kk: "Үй-жай қосу",
      }, { id: "delete", ru: "Удалить анкету", kk: "Өтінімді жою" }],
    )
  ),
  def(
    "message.registration.fix_select",
    "Исправление — выбор анкеты",
    "/fix",
    [R + "kakuyu_anketu_ispravit"],
    (l) =>
      l === "kk"
        ? "Қайсысын түзетеміз?\n{registrations}"
        : "Какую анкету исправить?\n{registrations}",
    [{
      id: "fix",
      ru: "Исправить — {index}",
      kk: "Түзету — {index}",
      variables: [{
        name: "index",
        description: "Номер анкеты в списке",
        example: "1",
      }],
    }],
  ),
  def(
    "message.registration.fix_name_reason",
    "Исправление — вопрос администратора и имя",
    "/fix",
    [
      R + "vopros_administratora",
      R + "vvedite_imya_i_familiyu_ili_tochku_chtoby",
    ],
    (l) =>
      old(R + "vopros_administratora", l) + ": {reason}\n" +
      old(R + "vvedite_imya_i_familiyu_ili_tochku_chtoby", l),
  ),
  def("message.registration.building_unknown", "Неверный номер дома — список по очередям", "/add", [],
    l => l === "kk" ? "Үй табылмады. Өз үйіңізді таңдаңыз:\n{buildings}" : "Дом не найден. Выберите свой дом:\n{buildings}"),
  def("message.registration.building_phase", "Очередь в подсказке домов", "/add", [],
    l => l === "kk" ? "{phase}-кезек" : "Очередь {phase}"),
  def("message.registration.building_unassigned", "Дома без очереди", "/add", [],
    l => l === "kk" ? "Кезек көрсетілмеген" : "Очередь не указана"),
  def("message.registration.buildings_empty", "Нет домов для выбора", "/add", [],
    l => l === "kk" ? "Үйлер әлі қосылмаған. Кейінірек қайталап көріңіз." : "Дома пока не добавлены. Попробуйте позже."),
  def("message.registration.building_choice_expired", "Устаревшая ссылка выбора дома", "/add", [],
    l => l === "kk" ? "Бұл үйді таңдау енді белсенді емес. Ағымдағы диалогты жалғастырыңыз." : "Этот выбор дома уже неактивен. Продолжите текущий диалог."),
  def(
    "message.registration.building",
    "Регистрация — номер дома текстом",
    "/register",
    [R + "vyberite_zdanie"],
    (l) =>
      l === "kk"
        ? "Үйіңіздің нөмірін жазыңыз (мысалы, 107/2)."
        : "Напишите номер вашего дома (например, 107/2).",
    [{ id: "cancel", ru: "Отменить", kk: "Болдырмау" }],
  ),
  def(
    "message.registration.kind",
    "Регистрация — тип помещения",
    "/register",
    [R + "tip_pomescheniya"],
    (l) => old(R + "tip_pomescheniya", l),
    [{
      id: "kind",
      ru: "{label}",
      kk: "{label}",
      variables: [{
        name: "label",
        description: "Название типа помещения",
        example: "Квартира",
      }],
    }],
  ),
  def(
    "message.registration.role",
    "Регистрация — роль жителя",
    "/register",
    [R + "vasha_rol"],
    (l) => old(R + "vasha_rol", l),
    [{
      id: "role",
      ru: "{label}",
      kk: "{label}",
      variables: [{
        name: "label",
        description: "Название роли",
        example: "Собственник",
      }],
    }],
  ),
  def(
    "message.registration.invite_consent",
    "Приглашение — согласие на обработку данных",
    "/start invite_*",
    [R + "podtverdite_soglasie_na_obrabotku_imeni_i_telefona"],
    (l) =>
      "<b>{full_name}</b>, {phone}\n" +
      old(R + "podtverdite_soglasie_na_obrabotku_imeni_i_telefona", l),
    consentButtons,
  ),
  ...["consent", "premises_consent", "fix_consent"].map((name) =>
    def(
      "message.registration." + name,
      name === "consent"
        ? "Регистрация — проверка данных и согласие"
        : name === "premises_consent"
        ? "Добавление помещения — проверка данных и согласие"
        : "Исправление — проверка данных и согласие",
      name === "premises_consent"
        ? "/add"
        : name === "fix_consent"
        ? "/fix"
        : "/register",
      [
        R + "proverte",
        R + "soglasie_na_obrabotku_etih_dannyh_dlya_registratsii",
        ...(name === "fix_consent" ? [R + "pomeschenie_i_rol_sohraneny"] : []),
      ],
      (l) =>
        "<b>" + old(R + "proverte", l) + "</b>: {full_name}, {phone}" +
        (name === "fix_consent"
          ? ". " + old(R + "pomeschenie_i_rol_sohraneny", l)
          : ", {kind}" +
            (name === "premises_consent" ? " {code}/{number}" : "") +
            ", {role}.") +
        "\n" +
        (l === "kk"
          ? "ОСИ тіркелуі үшін осы деректерді өңдеуге келісім."
          : "Согласие на обработку этих данных для регистрации в ОСИ."),
      consentButtons,
    )
  ),
  def(
    "message.registration.consent_retry",
    "Регистрация — повторный запрос согласия",
    "/register",
    [R + "dlya_prodolzheniya_podtverdite_soglasie_otmena"],
    (l) =>
      l === "kk"
        ? "Жалғастыру үшін келісімді растаңыз."
        : "Для продолжения подтвердите согласие.",
    consentButtons,
  ),
  def(
    "message.registration.lite_consent",
    "Регистрация без помещения — проверка данных и согласие",
    "/register",
    [],
    (l) =>
      "<b>" + old(R + "proverte", l) + "</b>: {full_name}, {phone}.\n" +
      (l === "kk"
        ? "ОСИ тіркелуі үшін осы деректерді өңдеуге келісім."
        : "Согласие на обработку этих данных для регистрации в ОСИ."),
    consentButtons,
  ),
  def(
    "message.registration.correction_submitted", "Исправления отправлены", "/fix", [],
    l => l === "kk" ? "Түзетулер тексеруге жіберілді. Бұрынғы деректер мен қолжетімділік сақталды."
      : "Исправления отправлены на проверку. Прежние данные и доступ сохранены.",
    [{ id: "status", ru: "Статус анкеты", kk: "Өтінім күйі" }],
  ),
  def(
    "message.registration.submitted",
    "Анкета отправлена",
    "/register",
    [
      R + "anketa_prinyata_dostup_ozhidaet_podtverzhdeniya",
      R + "status_ankety",
    ],
    (l) => old(R + "anketa_prinyata_dostup_ozhidaet_podtverzhdeniya", l),
    [{ id: "status", ru: "Статус регистрации", kk: "Тіркелу күйі" }],
  ),
  def(
    "message.tasks.list",
    "Мои задания — список",
    "/tasks",
    [],
    () => "{tasks}",
  ),
  ...[false, true].map((method) =>
    def(
      "message.tasks.card" + (method ? "_methodology" : ""),
      method ? "Карточка задания с методичкой" : "Карточка задания",
      "/task",
      [
        "tasks.srok",
        ...(method ? ["tasks.metodichka_versiya_deystvuet_s"] : []),
      ],
      (l) =>
        "<b>{number}</b> — {title}\n{state}\n{instruction}\n" + (method
          ? old("tasks.metodichka_versiya_deystvuet_s", l).replace(
            "{value_1}",
            "{methodology_version}",
          ).replace(
            "{fmtday_t_methodology_as_row_created_at}",
            "{methodology_date}",
          ) + "\n"
          : "") +
        old("tasks.srok", l) + ": {due_at}{actions}",
      taskButtons,
    )
  ),
  def(
    "message.tasks.changed",
    "Состояние задания изменено",
    "/accepttask, /declinetask, /starttask, /pausetask",
    [],
    () => "{number} — {state}{actions}",
    taskButtons,
  ),
  def(
    "message.tasks.report_submitted",
    "Отчёт отправлен",
    "/submitreport",
    [],
    () => "{number} — {state}",
    taskButtons,
  ),
  def(
    "message.tasks.files",
    "Файлы задания",
    "/taskfiles",
    [],
    () => "{files}",
  ),
  def(
    "message.tasks.evidence_invalid",
    "Отчёт — неверный выбор доказательства",
    "/reporttask",
    ["tasks.vyberite_nomera_sohranennyh_faylov_cherez_zapyatuyu_ili"],
    (l) =>
      old("tasks.vyberite_nomera_sohranennyh_faylov_cherez_zapyatuyu_ili", l) +
      "{files}",
  ),
  def(
    "message.tasks.evidence",
    "Отчёт — выбор доказательства",
    "/reporttask",
    ["tasks.dokazatelstvo_iz_otpravte_fayl_dozhdites_sohraneniya_taskfiles"],
    (l) =>
      old(
        "tasks.dokazatelstvo_iz_otpravte_fayl_dozhdites_sohraneniya_taskfiles",
        l,
      ) + "{files}",
  ),
];
// Existing complete replies retain keys and history; only compositional fragments are hidden.
const consumed = new Set(defs.flatMap((d) => d.legacyKeys ?? []));
const internal = new Set([
  "registration.delete_own_reason",
  "registration.previous_access_retained",
  "registration.reshenie_sobstvennika",
  "tasks.vizit",
  "tasks.sohranen",
  "tasks.esche_v_ocheredi",
  "tasks.faylov_poka_net",
]);
const promoted = originals.filter((d) =>
  (d.key.startsWith("registration.") || d.key.startsWith("tasks.")) &&
  !consumed.has(d.key) && !internal.has(d.key)
).map((d) => ({
  ...d,
  scenario: d.key.startsWith("tasks.")
    ? "Задания исполнителя"
    : "Регистрация и доступ",
  command: d.key.startsWith("tasks.") ? "/task" : "/register",
  description: "Полное сообщение: " + d.title,
  examples: [{
    id: "default",
    title: "Пример сообщения",
    ru: Object.fromEntries(d.variables.map((v) => [v.name, v.example])),
    kk: Object.fromEntries(d.variables.map((v) => [v.name, v.example])),
  }],
} satisfies TemplateDef));
// The no-reason branch also remains a complete editable reply.
const fixName = originals.find((d) =>
  d.key === R + "vvedite_imya_i_familiyu_ili_tochku_chtoby"
)!;
promoted.push({
  ...fixName,
  scenario: "Регистрация и доступ",
  command: "/fix",
  description: "Исправление имени без вопроса администратора",
  examples: [{ id: "default", title: "Без вопроса", ru: {}, kk: {} }],
});
const overrides: Record<string, MessageButton[]> = {
  "registration.language_prompt": [{
    id: "ru",
    ru: "Русский (ru)",
    kk: "Русский (ru)",
  }, { id: "kk", ru: "Қазақша (kk)", kk: "Қазақша (kk)" }],
  "registration.podat_zapros_na_udalenie_ankety_i_dannyh": [{
    id: "confirm",
    ru: "Подтвердить удаление",
    kk: "Жоюды растау",
  }, { id: "cancel", ru: "Отменить", kk: "Болдырмау" }],
  "tasks.kogda_predlozhite_vizit_napishite_odnim_soobscheniem_naprimer": [{
    id: "today",
    ru: "Сегодня",
    kk: "Бүгін",
  }, { id: "tomorrow", ru: "Завтра", kk: "Ертең" }],
  "tasks.otchet_podgotovlen_submitreport_otpravit_na_proverku": [{
    id: "submit",
    ru: "Отправить отчёт",
    kk: "Есепті жіберу",
  }],
};
const actionKeys: Record<string, string> = {
  awaiting_acceptance:
    "help.deystviya_accepttask_nomer_prinyat_declinetask_nomer_prichina",
  accepted: "help.deystviya_starttask_nomer_nachat_rabotu",
  in_progress:
    "help.deystviya_reporttask_nomer_otchet_proposevisit_nomer_vizit",
  suspended: "help.deystviya_starttask_nomer_vozobnovit",
  rework: "help.deystviya_starttask_nomer_prodolzhit_posle_dorabotki",
  on_review: "help.otchet_na_proverke_u_administratora",
};
const stateButton: Record<string, string> = {
  awaiting_acceptance: "accept",
  accepted: "start",
  in_progress: "report",
  suspended: "resume",
  rework: "continue",
};
/** Each state has an editable complete body; action instructions are literal prose. */
const completeDefs = defs.flatMap((d) => {
  if (
    ![
      "message.tasks.card",
      "message.tasks.card_methodology",
      "message.tasks.changed",
      "message.tasks.report_submitted",
    ].includes(d.key)
  ) return [d];
  const states = d.key === "message.tasks.report_submitted"
    ? ["on_review"]
    : ["", ...Object.keys(actionKeys)];
  return states.map((state) => {
    const actionKey = actionKeys[state];
    const ru = d.ru.replace(
      "{actions}",
      state === "on_review" ? "\n" + old(actionKey!, "ru") : "",
    );
    const kk = d.kk.replace(
      "{actions}",
      state === "on_review" ? "\n" + old(actionKey!, "kk") : "",
    );
    const rows=state==='awaiting_acceptance'?[['accept','decline']]:state==='in_progress'?[['report','pause'],['problem','files']]:state==='suspended'?[]:[[stateButton[state]].filter((id):id is string=>!!id)].filter(row=>row.length);
    // Визиты и аварийный сигнал — только в активной работе (TASK_ACTIVE_WORK_STATES),
    // как и фактические кнопки карточки в bot/tasks.ts.
    if ((TASK_ACTIVE_WORK_STATES as string[]).includes(state)) rows.push(['visits','emergency']);
    const buttons = taskButtons.filter(b=>rows.flat().includes(b.id));
    return {
      ...d,
      key: d.key + (state ? "." + state : ""),
      title: d.title + (state ? " — " + TASK_STATE_TEXT[state]?.ru : ""),
      ru,
      kk,
      variables: d.variables.filter((v) => v.name !== "actions"),
      legacyKeys: [
        ...(d.legacyKeys ?? []),
        ...(actionKey && d.ru.includes("{actions}") ? [actionKey] : []),
      ],
      buttons,
      examples: d.examples?.map((e) => ({
        ...e,
        ru: {
          ...Object.fromEntries(
            Object.entries(e.ru).filter(([name]) => name !== "actions"),
          ),
          state: TASK_STATE_TEXT[state]?.ru ?? e.ru.state ?? "",
        },
        kk: {
          ...Object.fromEntries(
            Object.entries(e.kk).filter(([name]) => name !== "actions"),
          ),
          state: TASK_STATE_TEXT[state]?.kk ?? e.kk.state ?? "",
        },
        buttons: rows.map(row=>row.map(id=>({id}))),
      })),
    };
  });
});
function promotedCommand(key: string): string {
  if (key === "registration.anket_poka_net") return "/status";
  if (key === "registration.anket_na_podtverzhdenie_net") return "/pending";
  if (key === "registration.vydannyh_dostupov_net") return "/accesses";
  if (key === "registration.podtverzhdennyh_obektov_net") return "/objects";
  if (key.includes("udalenie_ankety")) return "/delete";
  if (key.includes("iz_status") || key.includes("otkroyte_status")) {
    return "/edit";
  }
  if (
    key.includes("ispravleniya") || key.includes("prezhniy") ||
    key.includes("ili_tochku")
  ) return "/fix";
  if (key.includes("_add") || key.includes("svyaz_uzhe")) return "/add";
  if (key === "tasks.zadaniy_net") return "/tasks";
  if (key.startsWith("tasks.")) {
    if (/vizit|vremya_odnim|kogda_predlozhite/.test(key)) {
      return "/proposevisit";
    }
    if (/otsutstvie_dostupa|snachala_otkroyte_task/.test(key)) {
      return "/noaccess";
    }
    if (key.includes("naydennaya_problema")) return "/problem";
    if (
      /otchet|obem|vypolneniya|vvedite_vremya|opishite_rezultat|ogranicheniya/
        .test(key)
    ) return "/reporttask";
    return "/task";
  }
  return "/register";
}
export const registrationTasksMessageTemplates: readonly TemplateDef[] = [
  ...completeDefs,
  ...promoted.map((d) => ({
    ...d,
    command: promotedCommand(d.key),
    scenario: scenarioFor(promotedCommand(d.key)),
  })).map((d) =>
    overrides[d.key]
      ? {
        ...d,
        buttons: overrides[d.key],
        examples: d.examples.map((e) => ({
          ...e,
          buttons: [overrides[d.key]!.map((b) => ({ id: b.id }))],
        })),
      }
      : d
  ),
];
