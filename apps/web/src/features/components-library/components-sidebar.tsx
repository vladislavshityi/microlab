import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import {
  COMPONENT_CATEGORIES,
  COMPONENT_DEFINITIONS,
  type ComponentCategory,
  type ComponentDefinition,
} from "@microlab/circuit-schema";

import { COMPONENT_DRAG_MIME } from "@/features/circuit-editor/drag-data";
import { addComponentAtViewCenter } from "@/features/circuit-editor/placement";
import { localized } from "@/i18n/localized";
import { t, type PlainTranslationKey } from "@/i18n/t";
import { useUiStore } from "@/stores/ui-store";

const CATEGORY_LABELS = {
  board: "components.category.board",
  basic: "components.category.basic",
  passive: "components.category.passive",
  output: "components.category.output",
  sensors: "components.category.sensors",
  displays: "components.category.displays",
} as const satisfies Record<ComponentCategory, PlainTranslationKey>;

function matches(definition: ComponentDefinition, query: string): boolean {
  if (query === "") {
    return true;
  }
  return [definition.type, localized(definition.displayName), localized(definition.description)]
    .join(" ")
    .toLocaleLowerCase()
    .includes(query);
}

function CatalogItem({ definition }: { definition: ComponentDefinition }) {
  const name = localized(definition.displayName);
  const description = localized(definition.description);
  // Плата MVP одна и всегда присутствует на схеме.
  if (definition.category === "board") {
    return (
      <li className="px-3 py-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[13px]">{name}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">{t("components.board.present")}</span>
        </div>
        <div className="line-clamp-2 text-xs text-muted-foreground">{description}</div>
      </li>
    );
  }
  return (
    <li>
      <button
        type="button"
        draggable
        aria-label={t("components.add", { name })}
        title={description}
        onDragStart={(event) => {
          event.dataTransfer.setData(COMPONENT_DRAG_MIME, definition.type);
          event.dataTransfer.effectAllowed = "copy";
        }}
        onClick={() => {
          addComponentAtViewCenter(definition.type);
        }}
        className="block w-full cursor-grab px-3 py-1 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:cursor-grabbing"
      >
        <span className="block truncate text-[13px]">{name}</span>
        <span className="line-clamp-2 text-xs text-muted-foreground">{description}</span>
      </button>
    </li>
  );
}

/**
 * Библиотека компонентов: определения из circuit-schema по категориям с поиском.
 * Компонент добавляется на схему перетаскиванием на холст или щелчком (в центр видимой
 * области холста).
 */
export function ComponentsSidebar() {
  const [query, setQuery] = useState("");
  const searchId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const searchRequested = useUiStore((state) => state.componentSearchRequested);

  // Клавиша A на холсте переводит фокус в поиск компонентов.
  useEffect(() => {
    if (searchRequested && searchRef.current !== null) {
      searchRef.current.focus();
      searchRef.current.select();
      useUiStore.getState().consumeComponentSearch();
    }
  }, [searchRequested]);
  const normalizedQuery = query.trim().toLocaleLowerCase();

  const groups = useMemo(
    () =>
      COMPONENT_CATEGORIES.map((category) => ({
        category,
        items: COMPONENT_DEFINITIONS.filter(
          (definition) => definition.category === category && matches(definition, normalizedQuery),
        ),
      })).filter((group) => group.items.length > 0),
    [normalizedQuery],
  );

  return (
    <div className="flex flex-col gap-2 py-2">
      <div className="relative px-2">
        <label htmlFor={searchId} className="sr-only">
          {t("components.search.label")}
        </label>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <input
          ref={searchRef}
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder={t("components.search.placeholder")}
          className="h-7 w-full rounded-md border bg-transparent pr-2 pl-7 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <p className="px-3 text-xs text-muted-foreground">{t("components.hint.add")}</p>
      {groups.length === 0 ? (
        <p className="px-3 py-1 text-[13px] text-muted-foreground">{t("components.search.empty")}</p>
      ) : (
        groups.map(({ category, items }) => (
          <section key={category} aria-labelledby={`${searchId}-${category}`}>
            <h3
              id={`${searchId}-${category}`}
              className="px-3 pt-1 pb-0.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase"
            >
              {t(CATEGORY_LABELS[category])}
            </h3>
            <ul>
              {items.map((definition) => (
                <CatalogItem key={definition.type} definition={definition} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
