import type { BotReply } from "./keyboard.ts";
import type { DbExecutor } from "../db/client.ts";
import type { Actor } from "../pdp/types.ts";
// Реестр сценариев бота — общий модуль для webhook (VS-2) и симулятора
// эмуляции (LLD-03 §3.16: POST /v1/emulation/simulate исполняет тот же
// сценарный модуль, что и бот). В VS-1 реестр пуст: сценарии приходят в VS-2.

/** Контекст исполнения сценария: под чьей учётной записью действует бот. */
export interface BotScenarioContext {
  actor?: Actor;
  executor?: DbExecutor;
  profileId: string;
  personId: string;
  fullName: string;
}

/** Сценарий диалога: принимает текст шага, возвращает ответ бота. */
export interface BotScenario {
  id: string;
  description: string;
  run(input: string, ctx: BotScenarioContext): Promise<BotReply>;
}

/** Реестр известных сценариев. Регистрация — при старте функции бота. */
export class ScenarioRegistry {
  readonly #scenarios = new Map<string, BotScenario>();

  public register(scenario: BotScenario): void {
    this.#scenarios.set(scenario.id, scenario);
  }

  public get(id: string): BotScenario | undefined {
    return this.#scenarios.get(id);
  }

  public listIds(): string[] {
    return [...this.#scenarios.keys()].sort();
  }
}
