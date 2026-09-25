import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface IconButtonProps extends Omit<ComponentProps<typeof Button>, "aria-label"> {
  /** Доступное имя и текст подсказки. */
  label: string;
}

/** Кнопка-иконка панели: всегда с aria-label и подсказкой с тем же текстом. */
export function IconButton({ label, children, ...props }: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={label} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
