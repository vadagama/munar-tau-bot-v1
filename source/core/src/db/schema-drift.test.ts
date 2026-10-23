// Защита от дрейфа схемы (инцидент 2026-10-23: «column b.kind does not exist» —
// миграция дропнула building.kind, а SQL бота продолжал её выбирать; падение
// проявилось только как 500 у Telegram уже в работе).
//
// Тест собирает схему из файлов миграций (create table, alter table add/drop/
// rename column, drop table) и проверяет каждую ссылку вида `алиас.колонка` во
// всех SQL-строках core и functions: алиас резолвится по `from|join <таблица>
// <алиас>`, колонка обязана существовать в схеме своей таблицы.
//
// Сознательные ограничения: SQL, собранный интерполяцией идентификаторов,
// не проверяется; неизвестные таблицы (CTE, представления, системные) и
// алиасы без резолва пропускаются — тест ловит ссылки к известным таблицам,
// а не полноту схемы.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// core/src/db → source/ (три уровня вверх).
const SOURCE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

/** Таблица → множество колонок (нижний регистр). */
type Schema = Map<string, Set<string>>;

const CONSTRAINT_KEYWORDS = new Set([
  "primary",
  "unique",
  "check",
  "foreign",
  "constraint",
  "exclude",
  "like",
]);

/** Псевдоотношения PostgreSQL — не проверяются по схеме. */
const PSEUDO_RELATIONS = new Set(["excluded", "new", "old"]);

function buildSchemaFromMigrations(): Schema {
  const dir = join(SOURCE_ROOT, "db", "migrations");
  const schema: Schema = new Map();
  const ensure = (raw: string): string => {
    const table = raw.replace(/^public\./i, "").toLowerCase();
    if (!schema.has(table)) schema.set(table, new Set());
    return table;
  };
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = readFileSync(join(dir, file), "utf8")
      .replace(/--[^\n]*/g, " ")
      .replace(/\/\*[\s\S]*?\*\//g, " ");
    for (const m of sql.matchAll(
      /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?([\w.]+)\s*\(/gi,
    )) {
      const table = ensure(m[1]!);
      const body = balancedBody(sql, (m.index ?? 0) + m[0].length - 1);
      for (const part of splitTopLevel(body)) {
        const name = part.trim().split(/\s+/)[0]?.toLowerCase();
        if (name && !CONSTRAINT_KEYWORDS.has(name)) {
          schema.get(table)!.add(name);
        }
      }
    }
    for (const m of sql.matchAll(
      /\balter\s+table\s+(?:only\s+)?([\w.]+)\s+([^;]+)/gi,
    )) {
      const table = m[1]!.replace(/^public\./i, "").toLowerCase();
      if (!schema.has(table)) continue;
      const columns = schema.get(table)!;
      for (const part of splitTopLevel(m[2] ?? "")) {
        const clause = part.trim();
        const add = clause.match(
          /\badd\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?([\w]+)/i,
        );
        const drop = clause.match(
          /\bdrop\s+(?:column\s+)?(?:if\s+exists\s+)?([\w]+)/i,
        );
        const rename = clause.match(
          /\brename\s+column\s+([\w]+)\s+to\s+([\w]+)/i,
        );
        if (rename) {
          if (columns.delete(rename[1]!.toLowerCase())) {
            columns.add(rename[2]!.toLowerCase());
          }
        } else if (drop) {
          columns.delete(drop[1]!.toLowerCase());
        } else if (add && !CONSTRAINT_KEYWORDS.has(add[1]!.toLowerCase())) {
          columns.add(add[1]!.toLowerCase());
        }
      }
    }
    for (const m of sql.matchAll(
      /\bdrop\s+table\s+(?:if\s+exists\s+)?([\w.]+)/gi,
    )) {
      schema.delete(m[1]!.replace(/^public\./i, "").toLowerCase());
    }
  }
  return schema;
}

/** Тело между "(" на позиции openIndex и парной ему ")" (скобки не включены). */
function balancedBody(sql: string, openPos: number): string {
  let depth = 0;
  for (let i = openPos; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")") {
      depth--;
      if (depth === 0) return sql.slice(openPos + 1, i);
    }
  }
  return sql.slice(openPos + 1);
}

/** Разбиение по запятым верхнего уровня (скобки учитываются). */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/**
 * SQL-строки из TS-файла: содержимое template-литералов (интерполяции
 * вырезаются — они не статический SQL) и одинарных/двойных кавычек.
 * Возвращаются только литералы, похожие на SQL.
 */
function extractSqlLiterals(code: string): string[] {
  const literals: string[] = [];
  for (const m of code.matchAll(/`((?:[^`\\]|\\.)*)`/gs)) {
    literals.push(m[1]!.replace(/\$\{[^}]*\}/g, " "));
  }
  for (const m of code.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) {
    literals.push(m[1]!);
  }
  for (const m of code.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)) {
    literals.push(m[1]!);
  }
  return literals.filter((text) =>
    /\bselect\b[\s\S]*\bfrom\b|\binsert\s+into\b|\bupdate\s+\w+\s+set\b|\bdelete\s+from\b/i
      .test(text)
  );
}

const ALIAS_KEYWORDS = new Set([
  "where",
  "set",
  "on",
  "group",
  "order",
  "limit",
  "offset",
  "returning",
  "union",
  "intersect",
  "except",
  "values",
  "for",
  "using",
  "natural",
  "inner",
  "left",
  "right",
  "full",
  "cross",
  "lateral",
  "as",
  "and",
  "or",
  "not",
  "case",
  "when",
  "then",
  "else",
  "end",
]);

/** Резолв алиасов SQL: `from|join <таблица> [<алиас>]`. */
function resolveAliases(sql: string): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const m of sql.matchAll(
    /\b(?:from|join)\s+([a-z_][\w]*)(?:\s+(?:as\s+)?([a-z_][\w]*))?/gi,
  )) {
    const table = m[1]!.toLowerCase();
    const second = m[2]?.toLowerCase();
    if (second && !ALIAS_KEYWORDS.has(second)) {
      aliases.set(second.toLowerCase(), table);
    } else if (!m[2]) {
      aliases.set(table, table);
    }
  }
  return aliases;
}

/** CTE-имена литерала: `with [recursive] name as (...)`, `, name as (...)`. */
function cteNames(sql: string): Set<string> {
  const names = new Set<string>();
  for (const m of sql.matchAll(/\b([a-z_][\w]*)\s+as\s*\(/gi)) {
    names.add(m[1]!.toLowerCase());
  }
  return names;
}

function collectViolations(
  schema: Schema,
  file: string,
  code: string,
): string[] {
  const violations: string[] = [];
  for (const literal of extractSqlLiterals(code)) {
    // Содержимое SQL-строк ('…') не является ссылкой колонка — вырезаем,
    // чтобы не ловить точки в литералах (даты, форматы, русские тексты).
    const sql = literal.replace(/'(?:[^'\\]|\\.)*'/g, "''");
    const aliases = resolveAliases(sql);
    const ctes = cteNames(sql);
    for (const m of sql.matchAll(/\b([a-z_][\w]*)\.([a-z_][\w]*)/g)) {
      const alias = m[1]!.toLowerCase();
      const column = m[2]!.toLowerCase();
      if (PSEUDO_RELATIONS.has(alias) || ctes.has(alias)) continue;
      const table = aliases.get(alias);
      if (!table) continue; // алиас не резолвится — не наш случай
      const columns = schema.get(table);
      if (!columns) continue; // таблица не из миграций (view/системная) — пропуск
      if (!columns.has(column)) {
        violations.push(`${file}: "${alias}.${column}" — в ${table} нет колонки`);
      }
    }
  }
  return violations;
}

function collectFiles(root: string, skip: string[] = []): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (skip.includes(entry.name)) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(path, skip));
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(path);
  }
  return files;
}

describe("SQL не ссылается на колонки, которых нет в миграциях", () => {
  const schema = buildSchemaFromMigrations();
  const skip = ["node_modules", "dist", ".temp", "supabase", "migrations"];

  it("схема из миграций содержит ключевые таблицы", () => {
    for (const table of ["building", "premises", "profile", "notification"]) {
      expect(schema.has(table), `нет таблицы ${table}`).toBe(true);
    }
    // REG-11: building.kind дропнут — тест схемы обязан это знать.
    expect(schema.get("building")!.has("kind")).toBe(false);
  });

  it("ссылки алиас.колонка во всех SQL core и functions существуют в схеме", () => {
    const violations: string[] = [];
    for (
      const dir of [
        join(SOURCE_ROOT, "core", "src"),
        join(SOURCE_ROOT, "functions"),
      ]
    ) {
      for (const file of collectFiles(dir, skip)) {
        violations.push(
          ...collectViolations(schema, file, readFileSync(file, "utf8")),
        );
      }
    }
    expect(violations).toEqual([]);
  });
});
