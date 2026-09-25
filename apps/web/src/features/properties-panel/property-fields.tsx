import { useId, useState } from "react";
import type { EnumPropertyDefinition, NumberPropertyDefinition } from "@microlab/circuit-schema";

import { formatQuantityText, parseQuantity } from "@/features/circuit-model/quantity";
import { localized } from "@/i18n/localized";
import { locale, t } from "@/i18n/t";
import { cn } from "@/lib/utils";

const INPUT_CLASS =
  "h-7 w-full rounded-md border border-input bg-transparent px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-error";

/** Пометка свойства, которое симулятор не использует. */
function NotSimulatedNote({ id }: { id: string }) {
  return (
    <p id={id} className="text-[11px] text-muted-foreground">
      {t("properties.notSimulated")}
    </p>
  );
}

interface NumberInputProps {
  property: NumberPropertyDefinition;
  value: number;
  inputId: string;
  describedBy: string | undefined;
  onCommit: (value: number) => void;
}

/**
 * Поле числа с единицами. Значение применяется по Enter или при потере фокуса;
 * Esc возвращает текущее значение. Некорректный ввод не применяется.
 */
function NumberInput({ property, value, inputId, describedBy, onCommit }: NumberInputProps) {
  const formatted = formatQuantityText(value, property.unit, locale);
  const [draft, setDraft] = useState(formatted);
  const [error, setError] = useState<string | null>(null);
  const errorId = `${inputId}-error`;

  const commit = () => {
    if (draft === formatted) {
      setError(null);
      return;
    }
    const parsed = parseQuantity(draft, property.unit);
    if (parsed === null) {
      setError(t("properties.error.unparsable"));
      return;
    }
    if (parsed < property.minimum || parsed > property.maximum) {
      setError(
        t("properties.error.range", {
          min: formatQuantityText(property.minimum, property.unit, locale),
          max: formatQuantityText(property.maximum, property.unit, locale),
        }),
      );
      return;
    }
    setError(null);
    onCommit(parsed);
    setDraft(formatQuantityText(parsed, property.unit, locale));
  };

  return (
    <>
      <input
        id={inputId}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        value={draft}
        aria-invalid={error !== null}
        aria-describedby={[error === null ? undefined : errorId, describedBy].filter(Boolean).join(" ") || undefined}
        className={cn(INPUT_CLASS, "font-mono")}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setDraft(formatted);
            setError(null);
          }
        }}
      />
      {error !== null && (
        <p id={errorId} role="alert" className="text-[11px] text-error">
          {error}
        </p>
      )}
    </>
  );
}

export function NumberPropertyField({
  property,
  value,
  onChange,
}: {
  property: NumberPropertyDefinition;
  value: number;
  onChange: (value: number) => void;
}) {
  const inputId = useId();
  const noteId = `${inputId}-note`;
  const hintId = `${inputId}-hint`;
  const label = localized(property.displayName);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-xs text-muted-foreground">
        {label}
      </label>
      {/* Ключ по значению: при изменении извне (отмена, пресет) поле показывает новое значение. */}
      <NumberInput
        key={value}
        property={property}
        value={value}
        inputId={inputId}
        describedBy={property.simulated ? hintId : `${hintId} ${noteId}`}
        onCommit={onChange}
      />
      <p id={hintId} className="text-[11px] text-muted-foreground">
        {t("properties.range", {
          min: formatQuantityText(property.minimum, property.unit, locale),
          max: formatQuantityText(property.maximum, property.unit, locale),
        })}
      </p>
      {property.presets !== undefined && property.presets.length > 0 && (
        <div role="group" aria-label={t("properties.presets", { name: label })} className="flex flex-wrap gap-1">
          {property.presets.map((preset) => (
            <button
              key={preset}
              type="button"
              aria-pressed={preset === value}
              onClick={() => {
                onChange(preset);
              }}
              className="rounded border px-1.5 py-0.5 font-mono text-[11px] outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-ring aria-pressed:bg-accent"
            >
              {formatQuantityText(preset, property.unit, locale)}
            </button>
          ))}
        </div>
      )}
      {!property.simulated && <NotSimulatedNote id={noteId} />}
    </div>
  );
}

export function EnumPropertyField({
  property,
  value,
  onChange,
}: {
  property: EnumPropertyDefinition;
  value: string;
  onChange: (value: string) => void;
}) {
  const inputId = useId();
  const noteId = `${inputId}-note`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-xs text-muted-foreground">
        {localized(property.displayName)}
      </label>
      <select
        id={inputId}
        value={value}
        aria-describedby={property.simulated ? undefined : noteId}
        className={cn(INPUT_CLASS, "bg-background")}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        {property.options.map((option) => (
          <option key={option.value} value={option.value}>
            {localized(option.label)}
          </option>
        ))}
      </select>
      {!property.simulated && <NotSimulatedNote id={noteId} />}
    </div>
  );
}
