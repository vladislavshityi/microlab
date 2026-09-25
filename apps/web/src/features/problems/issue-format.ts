import type { CircuitIssue, CircuitValidationResponse, IssueCode } from "@/api/schemas";
import { locale, t, translateWith, type TranslationKey } from "@/i18n/t";

/** Ключ сообщения UI для кода замечания (сообщение API — только для логов и клиентов API). */
export const ISSUE_MESSAGE_KEYS = {
  INVALID_DOCUMENT: "issue.INVALID_DOCUMENT",
  UNSUPPORTED_SCHEMA_VERSION: "issue.UNSUPPORTED_SCHEMA_VERSION",
  DUPLICATE_COMPONENT_ID: "issue.DUPLICATE_COMPONENT_ID",
  DUPLICATE_CONNECTION_ID: "issue.DUPLICATE_CONNECTION_ID",
  UNKNOWN_COMPONENT_TYPE: "issue.UNKNOWN_COMPONENT_TYPE",
  NOT_A_BOARD: "issue.NOT_A_BOARD",
  BOARD_AS_COMPONENT: "issue.BOARD_AS_COMPONENT",
  UNKNOWN_PROPERTY: "issue.UNKNOWN_PROPERTY",
  INVALID_PROPERTY: "issue.INVALID_PROPERTY",
  BROKEN_CONNECTION_REFERENCE: "issue.BROKEN_CONNECTION_REFERENCE",
  UNKNOWN_PIN: "issue.UNKNOWN_PIN",
  NON_ORTHOGONAL_ROUTE: "issue.NON_ORTHOGONAL_ROUTE",
  POWER_SHORT_TO_GROUND: "issue.POWER_SHORT_TO_GROUND",
  POWER_RAILS_SHORTED: "issue.POWER_RAILS_SHORTED",
  VIN_CONNECTED_TO_RAIL: "issue.VIN_CONNECTED_TO_RAIL",
  OUTPUT_TO_RAIL: "issue.OUTPUT_TO_RAIL",
  OUTPUTS_CONNECTED: "issue.OUTPUTS_CONNECTED",
  LED_WITHOUT_RESISTOR: "issue.LED_WITHOUT_RESISTOR",
  LED_REVERSED: "issue.LED_REVERSED",
  GPIO_CURRENT_EXCEEDS_LIMIT: "issue.GPIO_CURRENT_EXCEEDS_LIMIT",
  GPIO_GROUP_CURRENT_EXCEEDS_LIMIT: "issue.GPIO_GROUP_CURRENT_EXCEEDS_LIMIT",
  MISSING_GROUND: "issue.MISSING_GROUND",
  FLOATING_POWER_PIN: "issue.FLOATING_POWER_PIN",
  POWER_DOMAIN_MISMATCH: "issue.POWER_DOMAIN_MISMATCH",
  SERIAL_PINS_USED: "issue.SERIAL_PINS_USED",
  I2C_PINS_USED: "issue.I2C_PINS_USED",
  SPI_PINS_USED: "issue.SPI_PINS_USED",
} as const satisfies Record<IssueCode, TranslationKey>;

const NUMBER_FORMAT = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });

function formatParam(name: string, value: string | number): string {
  if (typeof value === "number") return NUMBER_FORMAT.format(value);
  if (name === "direction" && (value === "source" || value === "sink")) {
    return t(value === "source" ? "problems.direction.source" : "problems.direction.sink");
  }
  return value;
}

/** Сообщение замечания на языке UI; если параметров не хватает — сообщение API. */
export function issueMessage(issue: CircuitIssue): string {
  const params = Object.fromEntries(
    Object.entries(issue.params).map(([name, value]) => [name, formatParam(name, value)]),
  );
  const text = translateWith(ISSUE_MESSAGE_KEYS[issue.code], params);
  return /\{\w+\}/.test(text) ? issue.message : text;
}

export interface IssueTargets {
  componentIds: string[];
  connectionIds: string[];
}

export interface CircuitLookup {
  boardId: string;
  component: (id: string) => boolean;
  connection: (id: string) => boolean;
  /** Провода схемы: концы в виде `componentId.pinId`. */
  wires: readonly { id: string; from: string; to: string }[];
}

/**
 * Объекты схемы, которые выделяются по щелчку на замечании: компоненты, провода и
 * компоненты выводов, а также провода узлов, на которые ссылается замечание; если
 * ссылок на объекты нет — компоненты узла (кроме платы). Удалённые объекты пропускаются.
 */
export function issueTargets(
  issue: CircuitIssue,
  nets: CircuitValidationResponse["nets"],
  exists: CircuitLookup,
): IssueTargets {
  const components = new Set<string>();
  const connections = new Set<string>();
  const netMembers: string[] = [];
  for (const ref of issue.refs) {
    if (ref.kind === "component") components.add(ref.id);
    else if (ref.kind === "connection") connections.add(ref.id);
    else if (ref.kind === "pin") components.add(ref.id.split(".")[0] ?? ref.id);
    else if (ref.kind === "net") netMembers.push(...(nets.find((net) => net.id === ref.id)?.members ?? []));
  }
  const inNets = new Set(netMembers);
  const hadObjects = components.size > 0 || connections.size > 0;
  for (const wire of exists.wires) {
    if (inNets.has(wire.from) || inNets.has(wire.to)) connections.add(wire.id);
  }
  if (!hadObjects) {
    for (const member of netMembers) {
      const id = member.split(".")[0] ?? member;
      if (id !== exists.boardId) components.add(id);
    }
  }
  return {
    componentIds: [...components].filter(exists.component),
    connectionIds: [...connections].filter(exists.connection),
  };
}

export interface IssueCounts {
  errors: number;
  warnings: number;
  infos: number;
}

export function countIssues(issues: readonly CircuitIssue[]): IssueCounts {
  const counts: IssueCounts = { errors: 0, warnings: 0, infos: 0 };
  for (const issue of issues) {
    if (issue.severity === "ERROR") counts.errors += 1;
    else if (issue.severity === "WARNING") counts.warnings += 1;
    else counts.infos += 1;
  }
  return counts;
}
