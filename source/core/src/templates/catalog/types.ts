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
}
