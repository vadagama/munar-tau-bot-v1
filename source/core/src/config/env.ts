// Чтение переменных среды: секреты и конфигурация приходят только из env сервера
// (HLD §15, ADR-003). Ядро не знает о конкретном рантайме: источник env передаётся
// вызывающей стороной (функции передают Deno.env.get, тесты — подставку).

/** Источник значений env по имени. */
export type EnvSource = (name: string) => string | undefined;

/** Ошибка конфигурации: отсутствует или некорректна обязательная переменная среды. */
export class ConfigError extends Error {
  public readonly variable: string;

  public constructor(variable: string, message?: string) {
    super(message ?? `Отсутствует обязательная переменная среды: ${variable}`);
    this.name = "ConfigError";
    this.variable = variable;
  }
}

/** Обязательная переменная: отсутствие — ошибка конфигурации среды. */
export function requireEnv(source: EnvSource, name: string): string {
  const value = source(name);
  if (value === undefined || value === "") {
    throw new ConfigError(name);
  }
  return value;
}

/** Необязательная переменная: undefined, если не задана или пустая. */
export function optionalEnv(source: EnvSource, name: string): string | undefined {
  const value = source(name);
  return value === undefined || value === "" ? undefined : value;
}

/** Источник env из объекта (тесты, локальные проверки). */
export function envFromRecord(record: Record<string, string | undefined>): EnvSource {
  return (name: string) => record[name];
}
