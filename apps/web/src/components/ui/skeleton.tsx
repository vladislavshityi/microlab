import type * as React from "react"

import { cn } from "@/lib/utils"

// Сгенерировано shadcn@4.21.0 (new-york). MicroLab: `bg-muted` (при reduced motion
// статичен благодаря index.css).

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
