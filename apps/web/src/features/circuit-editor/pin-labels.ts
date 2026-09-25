import type { ElectricalType } from "@microlab/circuit-schema";

import type { PlainTranslationKey } from "@/i18n/t";

/** Подписи электрических типов выводов. */
export const ELECTRICAL_TYPE_LABELS = {
  "power-input": "pin.type.powerInput",
  "power-output": "pin.type.powerOutput",
  ground: "pin.type.ground",
  "digital-input": "pin.type.digitalInput",
  "digital-output": "pin.type.digitalOutput",
  "analog-input": "pin.type.analogInput",
  "analog-output": "pin.type.analogOutput",
  bidirectional: "pin.type.bidirectional",
  passive: "pin.type.passive",
} as const satisfies Record<ElectricalType, PlainTranslationKey>;
