export type SectionId =
  | "registration"
  | "requests"
  | "tasks"
  | "incidents"
  | "help"
  | "errors"
  | "notices"
  | "common";
export interface TemplateVar {
  name: string;
  description: string;
  example: string;
}
export interface TemplateDef {
  key: string;
  section: SectionId;
  title: string;
  description: string;
  variables: readonly TemplateVar[];
  ru: string;
  kk: string;
  deprecated?: boolean;
  scenario?: string;
  command?: string;
  legacyKeys?: readonly string[];
  buttons?: readonly MessageButton[];
  examples?: readonly MessageExample[];
}

export interface MessageButton {
  id: string;
  ru: string;
  kk: string;
  variables?: readonly TemplateVar[];
}
export interface MessageExample {
  /** Trusted fixture blocks, generated only by server catalogue code. */
  blocks?: readonly string[];
  id: string;
  title: string;
  ru: Record<string, string>;
  kk: Record<string, string>;
  buttons?: {
    id: string;
    vars?: Record<string, string>;
    vars_ru?: Record<string, string>;
    vars_kk?: Record<string, string>;
  }[][];
}
