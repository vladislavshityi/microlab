import { CircleCheck, CircleQuestionMark, CircleX, TriangleAlert, type LucideIcon } from "lucide-react";

import type { StatusTone } from "./health-view";

// Одна иконка — одно значение во всём продукте.
export const TONE_ICON: Record<StatusTone, LucideIcon> = {
  success: CircleCheck,
  error: CircleX,
  warning: TriangleAlert,
  unknown: CircleQuestionMark,
};
