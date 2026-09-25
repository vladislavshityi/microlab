import { useEffect } from "react";

import { DARK_SCHEME_QUERY } from "@/lib/theme";
import { useUiStore } from "@/stores/ui-store";

/**
 * В режиме «Системная» следит за системной настройкой темы и переключает тему
 * без перезагрузки страницы.
 */
export function useThemeSync(): void {
  const preference = useUiStore((state) => state.themePreference);
  const setResolvedTheme = useUiStore((state) => state.setResolvedTheme);

  useEffect(() => {
    if (preference !== "system" || typeof window.matchMedia !== "function") {
      return undefined;
    }
    const query = window.matchMedia(DARK_SCHEME_QUERY);
    const update = () => {
      setResolvedTheme(query.matches ? "dark" : "light");
    };
    update();
    query.addEventListener("change", update);
    return () => {
      query.removeEventListener("change", update);
    };
  }, [preference, setResolvedTheme]);
}
