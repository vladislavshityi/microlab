import * as ResizablePrimitive from "react-resizable-panels"

import { cn } from "@/lib/utils"

// Сгенерировано shadcn@4.21.0 (new-york) для react-resizable-panels 4.x. Изменения MicroLab:
// - импорт `cn` из @/lib/utils;
// - ручка без «грипа»: видимая линия 1px, зона захвата 8px, при наведении, перетаскивании
//   и фокусе линия окрашивается в --ring.
function ResizablePanelGroup({
  className,
  ...props
}: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn(
        "flex h-full w-full aria-[orientation=vertical]:flex-col",
        className
      )}
      {...props}
    />
  )
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />
}

function ResizableHandle({
  className,
  ...props
}: ResizablePrimitive.SeparatorProps) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        "relative z-30 flex w-px items-center justify-center bg-border outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2 data-[separator=active]:bg-ring data-[separator=focus]:bg-ring data-[separator=hover]:bg-ring focus-visible:bg-ring aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:inset-x-0 aria-[orientation=horizontal]:after:top-1/2 aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-2 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2",
        className
      )}
      {...props}
    />
  )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
