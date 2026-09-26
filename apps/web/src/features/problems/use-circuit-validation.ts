import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { validateCircuit } from "@/api/validation";
import { denormalizeCircuit } from "@/features/circuit-model/circuit-document";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useCircuitStore } from "@/stores/circuit-store";

/** Задержка проверки после последнего изменения схемы, мс. */
const VALIDATION_DEBOUNCE_MS = 500;

/**
 * Проверка текущей схемы на backend: запрос уходит через {@link VALIDATION_DEBOUNCE_MS}
 * после последнего изменения. Пока идёт новая проверка, показывается предыдущий результат.
 */
export function useCircuitValidation() {
  const board = useCircuitStore((state) => state.board);
  const components = useCircuitStore((state) => state.components);
  const componentOrder = useCircuitStore((state) => state.componentOrder);
  const connections = useCircuitStore((state) => state.connections);
  const connectionOrder = useCircuitStore((state) => state.connectionOrder);
  const document = useMemo(
    () => denormalizeCircuit({ board, components, componentOrder, connections, connectionOrder }),
    [board, components, componentOrder, connections, connectionOrder],
  );
  const debounced = useDebouncedValue(document, VALIDATION_DEBOUNCE_MS);
  return useQuery({
    queryKey: ["circuitValidation", debounced],
    queryFn: ({ signal }) => validateCircuit(debounced, signal),
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}
