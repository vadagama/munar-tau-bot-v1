---
name: Кабинет ОСИ «Мунар Тау»
description: Спокойный деловой кабинет управления ОСИ — белые карточки на серо-ледяном фоне, 1px-разделители вместо теней, графитовый интерактив, зелёный бренд только в логотипе
colors:
  canvas: "#f6f7f8"
  surface: "#ffffff"
  hairline: "#eceef0"
  border: "#d9dce0"
  ink: "#24292f"
  ink-secondary: "#57606a"
  ink-muted: "#6e7781"
  graphite: "#1f2328"
  wash: "#f4f5f6"
  wash-deep: "#ebedef"
  success: "#1a7f37"
  brand-green: "#244c43"
typography:
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: "30px"
    fontWeight: 600
    lineHeight: "38px"
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: "18px"
    fontWeight: 600
    lineHeight: "32px"
  subtitle:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5714
  caption:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: "12px"
    fontWeight: 400
  numeric:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: "14px"
    fontWeight: 400
    fontFeature: "tabular-nums"
rounded:
  sm: "6px"
  md: "8px"
  panel: "12px"
  lg: "14px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.graphite}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "4px 15px"
  button-primary-hover:
    backgroundColor: "#323436"
  button-default:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "32px"
  button-default-hover:
    textColor: "#323436"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "4px 11px"
  menu-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.md}"
    height: "40px"
    padding: "0 16px"
  menu-item-hover:
    backgroundColor: "rgba(36, 41, 47, 0.04)"
    textColor: "{colors.ink}"
  menu-item-selected:
    backgroundColor: "{colors.wash-deep}"
    textColor: "{colors.ink}"
  badge-counter:
    backgroundColor: "{colors.ink-secondary}"
    textColor: "#ffffff"
    rounded: "999px"
    height: "20px"
  tag-default:
    backgroundColor: "{colors.wash}"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.sm}"
  tag-status-new:
    backgroundColor: "#eef0f2"
    textColor: "#57606a"
    rounded: "{rounded.sm}"
  tag-status-review:
    backgroundColor: "#e8edf6"
    textColor: "#275089"
    rounded: "{rounded.sm}"
  tag-status-work:
    backgroundColor: "#e6f2ec"
    textColor: "#1a6b45"
    rounded: "{rounded.sm}"
  tag-status-waiting:
    backgroundColor: "#faf1e2"
    textColor: "#8a5a10"
    rounded: "{rounded.sm}"
  tag-status-closed:
    backgroundColor: "#f2f3f4"
    textColor: "#57606a"
    rounded: "{rounded.sm}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "24px"
  card-small:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "12px"
  process-panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "16px"
---

# Design System: Кабинет ОСИ «Мунар Тау»

## Overview

**Creative North Star: «Спокойный пульт управления домом»** *(editor's choice: метафора предложена документатором на основе тезиса направления — «спокойный пульт управления домом»; пользователем не утверждалась).*

Кабинет — рабочее место сотрудников ОСИ: обращения, задания, аварии, сроки и эскалации. Красота здесь — в порядке, а не в декоре: ровные сетки, тихая палитра, предсказуемые блоки. Интерфейс сканируется взглядом — номер, состояние, срок, ответственный — и не требует «расшифровки» стиля.

Реализованный мир — светлое монохромно-нейтральное «бумажное» пространство attio-направления: белые поверхности на серо-ледяном фоне (#f6f7f8), тонкие 1px-разделители вместо теней, глубина через контраст поверхностей, а не через объём. Интерактив — графит #1f2328 (выбранный пользователем вариант B «нейтральный», применён в App.tsx); фирменный зелёный #244c43 — дозированно: только в логотипе и в запасной теме «green». Шрифт — системный стек; тени лёгкие, offset+blur; тёмной темы нет.

Плотность деловая: база 14px, таблицы среднего размера с табличными цифрами, единый шелл (сайдбар 240px, хедер 56px, контент до 1400px) и единая анатомия страницы. Движение — дефолтное AntD (≈0.2s), собственных анимаций система не заводит.

**Key Characteristics:**
- Белые карточки на серо-ледяном фоне (#ffffff на #f6f7f8); глубина — через 1px-разделители (#eceef0), не тени
- Графитовый интерактив (#1f2328); зелёный бренд (#244c43) — только в логотипе
- Лестница радиусов 6/8/12/14: контролы 8px, панель процесса 12px, карточки 14px
- Тихая серая шкала заливок (#f4f5f6 → #ebedef) вместо цветных акцентов
- Табличные цифры (tabular-nums) в таблицах и описаниях
- Единый шелл и анатомия страницы: сайдбар 240px → хедер 56px → контент max 1400px

## Colors

Монохромно-нейтральная «бумажная» гамма с одним тёмным интерактивным акцентом (графит) и дозированным брендовым зелёным; цвет в интерфейсе означает только состояние, а не украшение.

### Primary
- **Графит-интерактив** (#1f2328): primary-цвет варианта B — основная кнопка, ссылки, активные состояния, фокус. Наведение осветляет до #323436, нажатие — до #020203 (расчёт темы AntD от применённой конфигурации).

### Secondary
- **Фирменный зелёный** (#244c43): идентичность из лендинга — только в логотипе (BrandMark/BrandLogo) и в альтернативной теме «green» (hover #2e5f54). В интерактиве нейтрального варианта не участвует.

### Tertiary
- **Тихий успех** (#1a7f37): colorSuccess — статусы успеха. Семьи error/warning — дефолты AntD (error #ff4d4f, warning #faad14): просрочки (граница colorErrorBorder #ffccc7), баннер режима эмуляции (warning).

### Neutral
- **Серо-ледяной фон** (#f6f7f8): подложка контента и шелла; фон никогда не белый — на нём и читаются белые поверхности.
- **Белая поверхность** (#ffffff): карточки, сайдбар, хедер, контролы, панели.
- **Волосяной разделитель** (#eceef0): границы карточек, линии хедера/сайдбара, разделители под заголовками, линии таблиц.
- **Контурный бордер** (#d9dce0): границы контролов (инпуты, обычные кнопки).
- **Основной текст** (#24292f): заголовки и основной контент.
- **Второстепенный текст** (#57606a): подписи, метаданные, заголовки таблиц, счётчики.
- **Приглушённый текст** (#6e7781): placeholder и третичные подписи.
- **Тихая заливка** (#f4f5f6): дефолтные теги, info-фон.
- **Глубокая заливка** (#ebedef): выбранный пункт меню.

### Named Rules
**Правило нейтрального курсора (The Neutral Pointer Rule).** Интерактив — графит, а не цвет: primary, ссылки и фокус — оттенки #1f2328. Цвет означает только состояние (success/error/warning), никогда — действие.

**Правило дозированного зелёного (The Dosed Green Rule).** #244c43 живёт только в логотипе (и в запасной теме «green»); ни один интерактивный элемент нейтрального варианта его не использует.

**Правило явной info-семьи (The Explicit Info Rule).** Полутона info-семьи заданы вручную (#f4f5f6 / #eef0f1 / #e5e8ea / #d9dde0): генерация палитры AntD от тёмного primary даёт грязные оттенки — на неё не полагаемся.

## Typography

**Display Font:** нет отдельной дисплейной гарнитуры — весь интерфейс на системном стеке.
**Body Font:** system stack (-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif).
**Label/Mono Font:** нет отдельной; для числовых данных — фича tabular-nums.

**Character:** нейтральный системный шрифт — никакой «лица» гарнитуры, весь характер в весах, размерах и выравнивании. Тишина типографики — часть спокойствия системы: текст не спорит с данными.

### Hierarchy
- **Headline** (600, 30px/38px): заголовок страницы — Title level 2 в PageLayout («Очередь дня», «Обращения»), без отступа сверху.
- **Title** (600, 18px/32px): заголовок шелла «Кабинет администратора»; на странице входа — 20px.
- **Subtitle** (600, 16px, line-height 1.3): заголовки секций и карточек — панель процесса («Сейчас по процессу»), DetailSection.
- **Body** (400, 14px/1.5714): базовый текст, таблицы, меню, контролы.
- **Caption** (400, 12px): заголовки групп меню, мелкие пояснения («Завершаем вход…»).
- **Numeric** (400, 14px, font-feature tabular-nums): числовые колонки таблиц и содержимое Descriptions — разряды выравниваются по вертикали.
- Кнопки — 14px/500; выделенный текст (strong) — 600. Логотип — 700, 0.08em, капс «МУНАР ТАУ» (только компонент логотипа).

### Named Rules
**Правило ровных разрядов (The Aligned Digits Rule).** Числа в таблицах и Descriptions — tabular-nums: суммы, номера и сроки выстраиваются по разрядам, ритм данных «crisp».

## Layout

Пространственная модель — трёхзонный шелл. Слева светлый сайдбар 240px (белый, граница справа 1px #eceef0): логотип с подписью и меню по ролям. Сверху хедер 56px (белый, линия снизу 1px #eceef0, горизонтальный паддинг 24px): название кабинета слева, пользователь и выход справа. Контент — колонка до 1400px по центру с паддингом 24px 24px 48px. На экранах уже 992px (AntD breakpoint «lg») сайдбар сворачивается в ноль и открывается как fixed-слой поверх контента (высота 100dvh).

Анатомия страницы едина (PageLayout): заголовок страницы с переключателем вида → строка действий → строка фильтров → рабочая область. Вертикальный ритм зон — 24px; внутри строк заголовка/действий/фильтров — 16px. Карточные сетки — решётка AntD с желобами 16px (gutter [16,16]), две колонки от 992px (lg), одна — ниже.

Плотность деловая: таблицы среднего размера (size middle) с вертикальным паддингом ячейки 12px и hover строки #f8f9fa; меню — пункты 40px с заголовками групп 12px; карточки очереди показывают до 4 строк. Панель процесса на экранах ≤600px ужимается: паддинг 16→12px, действия в столбец.

### Named Rules
**Правило одной анатомии (The One Anatomy Rule).** Каждая страница — один PageLayout: заголовок → действия → фильтры → рабочая область; самодельных шапок не заводим.

## Elevation & Depth

Глубина передаётся прежде всего разделителями, а не тенями: белые поверхности на серо-ледяном фоне, границы 1px (#eceef0/#d9dce0). Тени есть, но тихие и подчинённые: базовая тень AntD переопределена на едва заметную двухслойную, «вторичная» — только для плавающих белых карточек поверх контента (карточка входа). Структурной роли тени не играют; тёмной темы нет — только светлый алгоритм (defaultAlgorithm).

### Shadow Vocabulary
- **Базовая тень** (`0 1px 2px rgba(16, 24, 40, 0.05), 0 1px 3px rgba(16, 24, 40, 0.06)`): всплывающие элементы — выпадающие меню, попапы, тултипы.
- **Вторичная тень** (`0 4px 12px rgba(16, 24, 40, 0.08)`): плавающие карточки поверх контента — карточка входа на фото-подложке.

### Named Rules
**Правило волосяной линии (The Hairline Rule).** Разделение поверхностей — 1px-линии (#eceef0/#d9dce0); тень не рисует структуру, а лишь приподнимает всплывающее.

## Shapes

Форма — тихая скруглённая лестница от 6 до 14px: контролы 8px (мелкие — теги 6px), панель процесса 12px, карточки 14px, карточка входа 14px, счётчик — полный круг. Все границы — 1px, скругления без «пузырей» и без контрастных обводок; у статусных тегов граница прозрачная (цвет держат фон и текст). Геометрия прямо предсказуема: без цветных боковых рамок и активных полос (activeBarBorderWidth: 0), без градиентного текста и декоративных надзаголовков.

## Components

### Buttons
- **Shape:** скругление 8px (md), высота 32px (small — 24px), вес 500.
- **Primary:** графит #1f2328, текст белый; наведение светлеет до #323436, нажатие — #020203 (расчёт темы AntD для варианта B).
- **Default:** белый фон, граница 1px #d9dce0, текст #24292f; при наведении текст и граница светлеют к #323436.
- **Остальные:** dashed/text/link — по AntD; danger — error-семья AntD (#ff4d4f).
- В панели процесса главная кнопка принудительно primary, остальные — default (ProcessActions); кнопки в панели многострочные (перенос текста, min-height 32px).

### Chips (Tags)
- **Дефолтный тег:** фон #f4f5f6, текст #57606a, радиус 6px.
- **Статусные теги (пиллы)** — 5 состояний, фон/текст, граница прозрачная: «Новая» #eef0f2/#57606a; «На рассмотрении» #e8edf6/#275089; «В работе» #e6f2ec/#1a6b45; «Ожидает жильца» #faf1e2/#8a5a10; «Закрыта» #f2f3f4/#57606a. Незнакомому статусу — нейтральная пара #eef0f2/#57606a.

### Cards / Containers
- **Corner Style:** 14px (borderRadiusLG).
- **Background:** белый на фоне #f6f7f8.
- **Shadow Strategy:** без тени; см. Elevation — глубину держит 1px-граница #eceef0 (colorBorderSecondary).
- **Border:** 1px #eceef0.
- **Internal Padding:** 24px (size small — 12px, например DetailSection).
- Блок очереди (QueueBlock): заголовок + тихий счётчик Badge в «extra», тело с вертикальным паддингом 8px, до 4 строк, ссылка «Открыть список →». Карточка просрочки — граница colorErrorBorder (#ffccc7) и текст danger.

### Inputs / Fields
- **Style:** белый фон, граница 1px #d9dce0, радиус 8px, высота 32px, паддинг 4px 11px, placeholder #6e7781.
- **Focus:** граница и мягкий ореол в графитовых полутонах (focus-тень AntD от colorPrimary).
- **Error / Disabled:** error-семья AntD; disabled — штатные состояния AntD.

### Navigation
- **Inline-меню светлого сайдбара:** пункт высотой 40px, радиус 8px, поля 8px по бокам; текст #57606a, наведение — #24292f на заливке rgba(36, 41, 47, 0.04); выбранное — #24292f на #ebedef. Цветной активной полосы нет.
- **Заголовки групп** — 12px; **счётчики** — Badge цвета #57606a, показываются только когда есть работа (overflow 99).
- **Логотип:** BrandLogo 24px («МУНАР ТАУ» + подпись «Кабинет ОСИ»), знак и текст — зелёный #244c43.

### Process Overview (signature)
Панель «Сейчас по процессу» — узнаваемый блок каждого процесса: белая секция с границей 1px #eceef0 (colorBorderSecondary), радиус 12px, паддинг 16px, вертикальный шаг 12px. Заголовочная строка (16px/600 + статусный тег) с волосяной линией #eceef0 под собой (padding-block-end 10px). Далее: название шага (strong 600), описание, «Ответственный», строка метаданных («Кто действует дальше: …» и «Срок: … (Алматы)» — второстепенным текстом), затем кнопки. Атрибут aria-label «Сейчас по процессу».

### Numeric Blocks
- **Таблицы:** шапка #fafbfb с текстом #57606a, линии #eceef0, hover строки #f8f9fa, вертикальный паддинг ячейки 12px, цифры — tabular-nums.
- **Descriptions:** size small, 2 колонки, tabular-nums (блок «Сеанс» на главной).

### Badge Counter
Тихий счётчик работы: фон #57606a (colorTextSecondary), текст белый, высота 20px, радиус полный, предел 99. Показывается только при наличии работы — пустота тоже сигнал.

## Do's and Don'ts

### Do:
- **Do** держите анатомию страницы PageLayout: заголовок → действия → фильтры → рабочая область; вертикальный ритм 24px.
- **Do** разделяйте поверхности 1px-линиями (#eceef0 для карточек и шелла, #d9dce0 для контролов) — не тенями.
- **Do** статусы показывайте картой статусных тегов (5 состояний, прозрачная граница); незнакомый статус — нейтральная пара #eef0f2/#57606a.
- **Do** числа в таблицах и Descriptions — tabular-nums.
- **Do** счётчики работы — тихий Badge (#57606a), только при наличии работы.
- **Do** радиусы по лестнице: контролы 8px, панель процесса 12px, карточки 14px.

### Don't:
- **Don't** цветные боковые рамки и активные полосы в меню — активность показываем только заливкой #ebedef (activeBarBorderWidth: 0).
- **Don't** зелёный #244c43 в интерактиве нейтрального варианта — он живёт только в логотипе (и в запасной теме «green»).
- **Don't** тёмная тема — только светлый defaultAlgorithm.
- **Don't** градиентный текст, kicker/eyebrow и декоративные акценты — красота в порядке сеток и предсказуемых блоков.
- **Don't** новые акцентные цвета сверх семей success/error/warning и карты статусных тегов.
