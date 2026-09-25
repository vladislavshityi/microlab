import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { IconButton } from "./icon-button";

interface SidePanelProps {
  title: string;
  collapsed: boolean;
  collapseLabel: string;
  expandLabel: string;
  /** Иконка кнопки сворачивания (в развёрнутом виде) и разворачивания (в свёрнутом). */
  collapseIcon: LucideIcon;
  expandIcon: LucideIcon;
  onCollapse: () => void;
  onExpand: () => void;
  children: ReactNode;
}

/**
 * Содержимое боковой панели: заголовок 32px с кнопкой сворачивания и прокручиваемый
 * контент. В свёрнутом виде — вертикальная полоса с кнопкой разворачивания.
 */
export function SidePanel({
  title,
  collapsed,
  collapseLabel,
  expandLabel,
  collapseIcon: CollapseIcon,
  expandIcon: ExpandIcon,
  onCollapse,
  onExpand,
  children,
}: SidePanelProps) {
  if (collapsed) {
    return (
      <div className="flex h-full flex-col items-center pt-1">
        <IconButton label={expandLabel} onClick={onExpand}>
          <ExpandIcon aria-hidden="true" />
        </IconButton>
      </div>
    );
  }
  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex h-8 shrink-0 items-center justify-between border-b pr-1 pl-3">
        <h2 className="truncate text-xs font-medium text-muted-foreground">{title}</h2>
        <IconButton label={collapseLabel} onClick={onCollapse}>
          <CollapseIcon aria-hidden="true" />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </div>
  );
}
