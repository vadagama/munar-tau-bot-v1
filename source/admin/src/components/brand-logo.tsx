// Логотип из лендинга (source/landing/index.html): знак горы + «МУНАР ТАУ».
// Используется в сайдбаре кабинета и на странице входа.
const MARK_PATHS = (
  <>
    <path d="M5 36 18 13l8 14 5-9 12 18H5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    <path d="m13 36 9-15M26 27l5 9" stroke="currentColor" strokeWidth="2" />
  </>
);

export function BrandMark({ size = 26, color = "#244c43" }: { size?: number; color?: string }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} fill="none" aria-hidden="true" style={{ color, flex: "none" }}>
      {MARK_PATHS}
    </svg>
  );
}

/** Полный знак: гора + название + (опционально) подпись ОСИ. */
export function BrandLogo({ size = 26, caption, color = "#244c43", textColor }: {
  size?: number;
  caption?: boolean | string;
  color?: string;
  textColor?: string;
}) {
  const captionText = caption === true ? "Объединение собственников имущества" : caption;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, minWidth: 0 }}>
      <BrandMark size={size} color={color} />
      <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2, minWidth: 0 }}>
        <span style={{
          fontWeight: 700, fontSize: size * 0.52, letterSpacing: "0.08em",
          color: textColor, whiteSpace: "nowrap",
        }}>
          МУНАР ТАУ
        </span>
        {captionText && (
          <span style={{ fontSize: size * 0.34, color: textColor ?? "#6e7781", whiteSpace: "nowrap", opacity: 0.85 }}>
            {captionText}
          </span>
        )}
      </span>
    </span>
  );
}
