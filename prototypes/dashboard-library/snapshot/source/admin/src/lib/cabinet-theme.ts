import { theme as antdTheme } from "antd";

// Айдентика кабинета (attio-направление): светлый нейтральный мир,
// фирменный зелёный из лендинга — дозированно (логотип, primary-действия).
// Кабинет работает в варианте A («зелёный»): тёмный графит варианта B
// в деле читался мрачно — решение пользователя 23.10.2026. Вариант B
// оставлен только для сравнения на dev-странице /theme-preview.
export const BRAND_GREEN = "#244c43";
export const BRAND_GREEN_HOVER = "#2e5f54";

export type CabinetVariant = "green" | "neutral";

const SYSTEM_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

// Единая тихая шкала для обоих вариантов: белые поверхности на серо-ледяном
// фоне, 1px-разделители, лёгкие тени с offset+blur.
const NEUTRAL_TOKENS = {
  colorBgLayout: "#f6f7f8",
  colorBgContainer: "#ffffff",
  colorBgElevated: "#ffffff",
  colorBorder: "#d9dce0",
  colorBorderSecondary: "#eceef0",
  colorText: "#24292f",
  colorTextSecondary: "#57606a",
  colorTextTertiary: "#6e7781",
  colorTextPlaceholder: "#6e7781",
  colorFillSecondary: "rgba(36, 41, 47, 0.06)",
  colorFillTertiary: "rgba(36, 41, 47, 0.04)",
  colorFillQuaternary: "rgba(36, 41, 47, 0.02)",
  // Info-семья задаётся явно: AntD выводит её из colorInfo, а тёмный primary
  // (графит в нейтральном варианте) даёт грязные полутона — не полагаемся
  // на генерацию палитры.
  colorInfoBg: "#f4f5f6",
  colorInfoBgHover: "#eef0f1",
  colorInfoBorder: "#e5e8ea",
  colorInfoBorderHover: "#d9dde0",
  fontFamily: SYSTEM_STACK,
  fontSize: 14,
  borderRadius: 8,
  borderRadiusSM: 6,
  borderRadiusLG: 14,
  boxShadow: "0 1px 2px rgba(16, 24, 40, 0.05), 0 1px 3px rgba(16, 24, 40, 0.06)",
  boxShadowSecondary: "0 4px 12px rgba(16, 24, 40, 0.08)",
  fontWeightStrong: 600,
  wireframe: false,
};

// Семью primary задаём явно по той же причине: генератор палитры AntD
// рассчитан на средне-яркие seed-цвета, и тёмный #244c43 даёт «светлый»
// конец шкалы грязно-серым — colorPrimaryBg #848c89, border #6c7371.
// С такими токенами выбранная карточка доски и панели действий выглядят
// затемнёнными, а шкала ещё и инвертирована (BgHover темнее Bg).
const GREEN_PRIMARY_FAMILY = {
  colorPrimaryBg: "#e9f2ee",
  colorPrimaryBgHover: "#dcebe4",
  colorPrimaryBorder: "#c3dcd2",
  colorPrimaryBorderHover: "#94c5b4",
  colorPrimaryHover: BRAND_GREEN_HOVER,
  colorPrimaryActive: "#1b3d35",
  colorPrimaryTextHover: BRAND_GREEN_HOVER,
  colorPrimaryTextActive: "#1b3d35",
  colorLinkHover: BRAND_GREEN_HOVER,
  colorLinkActive: "#1b3d35",
};

// Графит варианта B (только /theme-preview): та же проблема генерации.
const GRAPHITE_PRIMARY_FAMILY = {
  colorPrimaryBg: "#eef0f2",
  colorPrimaryBgHover: "#e3e6e9",
  colorPrimaryBorder: "#ced3d8",
  colorPrimaryBorderHover: "#aeb6bf",
  colorPrimaryHover: "#38414a",
  colorPrimaryActive: "#0f1317",
  colorPrimaryTextHover: "#38414a",
  colorPrimaryTextActive: "#0f1317",
  colorLinkHover: "#38414a",
  colorLinkActive: "#0f1317",
};

export function cabinetTheme(variant: CabinetVariant) {
  const primary = variant === "green" ? BRAND_GREEN : "#1f2328";
  return {
    algorithm: antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: primary,
      colorInfo: primary,
      colorLink: primary,
      colorSuccess: "#1a7f37",
      ...NEUTRAL_TOKENS,
      ...(variant === "green" ? GREEN_PRIMARY_FAMILY : GRAPHITE_PRIMARY_FAMILY),
    },
    components: {
      Layout: {
        siderBg: "#ffffff",
        headerBg: "#ffffff",
        headerHeight: 56,
        bodyBg: "#f6f7f8",
      },
      Menu: {
        itemBg: "transparent",
        itemColor: "#57606a",
        itemHoverColor: "#24292f",
        itemHoverBg: "rgba(36, 41, 47, 0.04)",
        itemSelectedColor: "#24292f",
        itemSelectedBg: "#ebedef",
        itemBorderRadius: 8,
        itemMarginInline: 8,
        activeBarBorderWidth: 0,
        groupTitleFontSize: 12,
        subMenuItemBg: "transparent",
        popupBg: "#ffffff",
      },
      Table: {
        headerBg: "#fafbfb",
        headerColor: "#57606a",
        headerSplitColor: "transparent",
        rowHoverBg: "#f8f9fa",
        borderColor: "#eceef0",
        cellPaddingBlock: 12,
      },
      Card: {
        paddingLG: 24,
      },
      Tag: {
        defaultBg: "#f4f5f6",
        defaultColor: "#57606a",
      },
      Button: {
        fontWeight: 500,
      },
      Typography: {
        titleMarginBottom: "0.35em",
      },
    },
  };
}
