import type { CircuitDocument } from "./generated/circuit";
import type { LocalizedText } from "./generated/component-definition";

/** Шаблон проекта: схема и код, из которых создаётся новый проект. */
export interface ProjectTemplate {
  /** Идентификатор шаблона (имя файла без расширения). */
  id: string;
  /** Порядок в меню. */
  order: number;
  name: LocalizedText;
  description: LocalizedText;
  code: string;
  circuit: CircuitDocument;
}
