import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// Сгенерировано shadcn@4.21.0 (new-york). Изменения MicroLab:
// - статусные варианты используют семантические токены статусов (`error` для статусов,
//   `destructive` только для действий);
// - нет жёстко заданного role="alert": вызывающий код помещает alert в собственный live region;
// - заголовок не обрезается по числу строк (русский текст длиннее).
const alertVariants = cva(
  "relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-lg border px-4 py-3 text-sm has-[>svg]:grid-cols-[calc(var(--spacing)*5)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-5 [&>svg]:text-current",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        success:
          "border-success/40 bg-success-muted text-success *:data-[slot=alert-description]:text-foreground",
        warning:
          "border-warning/40 bg-warning-muted text-warning *:data-[slot=alert-description]:text-foreground",
        error:
          "border-error/40 bg-error-muted text-error *:data-[slot=alert-description]:text-foreground",
        info: "border-info/40 bg-info-muted text-info *:data-[slot=alert-description]:text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      data-variant={variant}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn("col-start-2 min-h-4 font-medium tracking-tight", className)}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "col-start-2 grid justify-items-start gap-1 text-sm text-muted-foreground [&_p]:leading-relaxed",
        className
      )}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription }
