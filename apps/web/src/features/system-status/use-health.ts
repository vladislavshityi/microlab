import { useQuery } from "@tanstack/react-query";

import { fetchHealth } from "@/api/health";

export const healthQueryKey = ["health"] as const;

export function useHealth() {
  return useQuery({
    queryKey: healthQueryKey,
    queryFn: ({ signal }) => fetchHealth(signal),
    // Без автоматических повторов: fetchHealth не бросает исключений при сетевых/HTTP-ошибках
    // (это состояния), а повторы по умолчанию лишь задержали бы показ ошибки. Пользователь
    // повторяет проверку видимой кнопкой "Проверить снова".
    retry: false,
    // Без polling; refetch при фокусе окна остаётся включённым (по умолчанию
    // в TanStack Query).
    staleTime: 0,
  });
}
