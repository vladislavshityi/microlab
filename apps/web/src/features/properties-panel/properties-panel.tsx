import { useId, useState, type ReactNode } from "react";
import { RotateCw, Trash2 } from "lucide-react";
import {
  getComponentDefinition,
  type ComponentDefinition,
  type ComponentInstance,
  type PinRef,
} from "@microlab/circuit-schema";

import { Button } from "@/components/ui/button";
import { ELECTRICAL_TYPE_LABELS } from "@/features/circuit-editor/pin-labels";
import { DEFAULT_WIRE_COLOR, WIRE_COLORS, wireColorLabel } from "@/features/circuit-editor/wire-colors";
import { toPlacedInstance } from "@/features/circuit-model/geometry";
import { localized } from "@/i18n/localized";
import { t, type PlainTranslationKey } from "@/i18n/t";
import { cn } from "@/lib/utils";
import { useCircuitStore } from "@/stores/circuit-store";

import { EnumPropertyField, NumberPropertyField } from "./property-fields";
import { hasSimulationInputs } from "./simulation-input-types";
import { SimulationInputs } from "./simulation-inputs";

const REJECTION_MESSAGES: Readonly<Record<string, PlainTranslationKey>> = {
  SAME_PIN: "canvas.connection.samePin",
  DUPLICATE: "canvas.connection.duplicate",
  UNKNOWN_PIN: "canvas.connection.unknownPin",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-b px-3 py-3 last:border-b-0">
      <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-[13px]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate font-mono">{children}</dd>
    </div>
  );
}

function pinLabel(pin: PinRef): string {
  return `${pin.componentId}.${pin.pinId}`;
}

/** Все выводы схемы для выбора второго конца соединения. */
function useAllPins(): { componentId: string; definition: ComponentDefinition }[] {
  const boardId = useCircuitStore((state) => state.board.id);
  const boardType = useCircuitStore((state) => state.board.type);
  const components = useCircuitStore((state) => state.components);
  const order = useCircuitStore((state) => state.componentOrder);
  const result: { componentId: string; definition: ComponentDefinition }[] = [];
  const boardDefinition = getComponentDefinition(boardType);
  if (boardDefinition !== undefined) result.push({ componentId: boardId, definition: boardDefinition });
  for (const id of order) {
    const component = components[id];
    const definition = component && getComponentDefinition(component.type);
    if (definition !== undefined) result.push({ componentId: id, definition });
  }
  return result;
}

/**
 * Создание соединения выбором выводов из списков — клавиатурная альтернатива
 * протягиванию провода на холсте.
 */
function NewConnectionForm({ componentId, definition }: { componentId: string; definition: ComponentDefinition }) {
  const formId = useId();
  const allPins = useAllPins();
  const [fromPin, setFromPin] = useState(definition.pins[0].id);
  const [target, setTarget] = useState("");
  const [message, setMessage] = useState<PlainTranslationKey | null>(null);

  const submit = () => {
    const [targetComponent, targetPin] = target.split(".");
    if (targetComponent === undefined || targetPin === undefined) {
      return;
    }
    const rejection = useCircuitStore
      .getState()
      .connect({ componentId, pinId: fromPin }, { componentId: targetComponent, pinId: targetPin });
    setMessage(rejection === null ? "properties.connection.created" : (REJECTION_MESSAGES[rejection] ?? null));
  };

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label htmlFor={`${formId}-from`} className="text-xs text-muted-foreground">
        {t("properties.connection.fromPin")}
      </label>
      <select
        id={`${formId}-from`}
        value={fromPin}
        onChange={(event) => {
          setFromPin(event.target.value);
        }}
        className="h-7 rounded-md border border-input bg-background px-2 font-mono text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {definition.pins.map((pin) => (
          <option key={pin.id} value={pin.id}>
            {pin.name === pin.id ? pin.id : `${pin.id} (${pin.name})`}
          </option>
        ))}
      </select>
      <label htmlFor={`${formId}-to`} className="text-xs text-muted-foreground">
        {t("properties.connection.toPin")}
      </label>
      <select
        id={`${formId}-to`}
        value={target}
        onChange={(event) => {
          setTarget(event.target.value);
        }}
        className="h-7 rounded-md border border-input bg-background px-2 font-mono text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <option value="">{t("properties.connection.choosePin")}</option>
        {allPins.map(({ componentId: id, definition: pinDefinition }) => (
          <optgroup key={id} label={`${id} · ${localized(pinDefinition.displayName)}`}>
            {pinDefinition.pins.map((pin) => (
              <option key={pin.id} value={`${id}.${pin.id}`}>
                {id}.{pin.id}
                {pin.name === pin.id ? "" : ` (${pin.name})`}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <Button type="submit" size="xs" variant="secondary" disabled={target === ""}>
        {t("properties.connection.create")}
      </Button>
      {message !== null && (
        <p role="status" className="text-[11px] text-muted-foreground">
          {t(message)}
        </p>
      )}
    </form>
  );
}

function BoardPins({ definition }: { definition: ComponentDefinition }) {
  return (
    <table className="w-full text-left text-xs">
      <caption className="sr-only">{t("properties.board.pins")}</caption>
      <thead className="text-muted-foreground">
        <tr>
          <th scope="col" className="py-0.5 font-normal">
            {t("properties.board.pin")}
          </th>
          <th scope="col" className="py-0.5 font-normal">
            {t("properties.board.type")}
          </th>
          <th scope="col" className="py-0.5 font-normal">
            {t("properties.board.mcuPin")}
          </th>
        </tr>
      </thead>
      <tbody>
        {definition.pins.map((pin) => (
          <tr key={pin.id} className="border-t">
            <td className="py-0.5 font-mono">{pin.name === pin.id ? pin.id : `${pin.name} (${pin.id})`}</td>
            <td className="py-0.5">{t(ELECTRICAL_TYPE_LABELS[pin.electricalType])}</td>
            <td className="py-0.5 font-mono">{pin.mcuPin ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ComponentProperties({ id }: { id: string }) {
  const instance = useCircuitStore((state) => (id === state.board.id ? state.board : state.components[id]));
  const isBoard = useCircuitStore((state) => state.board.id === id);
  const definition = instance === undefined ? undefined : getComponentDefinition(instance.type);
  if (instance === undefined || definition === undefined) {
    return null;
  }
  const placed = toPlacedInstance(instance);
  const properties: ComponentInstance["properties"] = isBoard ? {} : (instance as ComponentInstance).properties;
  const store = useCircuitStore.getState;

  return (
    <div>
      <Section title={localized(definition.displayName)}>
        <dl className="flex flex-col gap-1">
          <Field label={t("properties.id")}>{id}</Field>
          <Field label={t("properties.type")}>{definition.type}</Field>
          <Field label={t("properties.position")}>
            {placed.position.x}, {placed.position.y}
          </Field>
          <Field label={t("properties.rotation")}>{placed.rotation}°</Field>
        </dl>
        <div className="flex gap-1">
          <Button
            type="button"
            size="xs"
            variant="secondary"
            onClick={() => {
              store().rotateItems([id]);
            }}
          >
            <RotateCw aria-hidden="true" />
            {t("properties.rotate")}
          </Button>
          {!isBoard && (
            <Button
              type="button"
              size="xs"
              variant="secondary"
              onClick={() => {
                store().deleteItems([id], []);
              }}
            >
              <Trash2 aria-hidden="true" />
              {t("properties.delete")}
            </Button>
          )}
        </div>
      </Section>
      {!isBoard && definition.properties.length > 0 && (
        <Section title={t("properties.section.parameters")}>
          {definition.properties.map((property) => {
            const value = properties[property.id] ?? property.default;
            if (property.type === "number") {
              return (
                <NumberPropertyField
                  key={property.id}
                  property={property}
                  value={typeof value === "number" ? value : property.default}
                  onChange={(next) => {
                    store().setProperty(id, property.id, next);
                  }}
                />
              );
            }
            return (
              <EnumPropertyField
                key={property.id}
                property={property}
                value={typeof value === "string" ? value : property.default}
                onChange={(next) => {
                  store().setProperty(id, property.id, next);
                }}
              />
            );
          })}
        </Section>
      )}
      {!isBoard && hasSimulationInputs(definition.type) && (
        <Section title={t("properties.section.simulation")}>
          <SimulationInputs id={id} definition={definition} properties={properties} />
        </Section>
      )}
      {isBoard && (
        <Section title={t("properties.board.pins")}>
          <BoardPins definition={definition} />
        </Section>
      )}
      <Section title={t("properties.section.newConnection")}>
        <NewConnectionForm key={id} componentId={id} definition={definition} />
      </Section>
      {definition.limitations.length > 0 && (
        <Section title={t("properties.section.limitations")}>
          <ul className="list-disc pl-4 text-xs text-muted-foreground">
            {definition.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function ConnectionProperties({ id }: { id: string }) {
  const connection = useCircuitStore((state) => state.connections[id]);
  const groupId = useId();
  if (connection === undefined) {
    return null;
  }
  const store = useCircuitStore.getState;
  const options: { value: string | undefined; label: PlainTranslationKey; swatch: string }[] = [
    { value: undefined, label: "wire.color.default", swatch: DEFAULT_WIRE_COLOR },
    ...WIRE_COLORS.map((color) => ({ value: color.value, label: color.label, swatch: color.value })),
  ];
  return (
    <div>
      <Section title={t("properties.wire.title")}>
        <dl className="flex flex-col gap-1">
          <Field label={t("properties.id")}>{id}</Field>
          <Field label={t("properties.wire.from")}>{pinLabel(connection.from)}</Field>
          <Field label={t("properties.wire.to")}>{pinLabel(connection.to)}</Field>
          <Field label={t("properties.wire.route")}>
            {connection.route === undefined
              ? t("properties.wire.routeAuto")
              : t("properties.wire.routeManual", { count: String(connection.route.length) })}
          </Field>
        </dl>
        <div className="flex flex-wrap gap-1">
          {connection.route !== undefined && (
            <Button
              type="button"
              size="xs"
              variant="secondary"
              onClick={() => {
                store().setConnectionRoute(id, undefined);
              }}
            >
              {t("properties.wire.resetRoute")}
            </Button>
          )}
          <Button
            type="button"
            size="xs"
            variant="secondary"
            onClick={() => {
              store().deleteItems([], [id]);
            }}
          >
            <Trash2 aria-hidden="true" />
            {t("properties.delete")}
          </Button>
        </div>
      </Section>
      <Section title={t("properties.wire.color")}>
        <div role="radiogroup" aria-labelledby={`${groupId}-label`} className="flex flex-col gap-1">
          <span id={`${groupId}-label`} className="sr-only">
            {t("properties.wire.color")}
          </span>
          <div className="flex flex-wrap gap-1">
            {options.map((option) => {
              const checked = (connection.color?.toLowerCase() ?? undefined) === option.value?.toLowerCase();
              return (
                <button
                  key={option.label}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  aria-label={t(option.label)}
                  title={t(option.label)}
                  onClick={() => {
                    store().setConnectionColor(id, option.value);
                  }}
                  className={cn(
                    "flex size-6 items-center justify-center rounded-md border outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    checked && "border-ring ring-1 ring-ring",
                  )}
                >
                  <span className="size-3.5 rounded-full" style={{ background: option.swatch }} aria-hidden="true" />
                </button>
              );
            })}
          </div>
          <p className="text-xs">{t(wireColorLabel(connection.color))}</p>
        </div>
        <p className="text-[11px] text-muted-foreground">{t("properties.wire.colorNote")}</p>
      </Section>
    </div>
  );
}

/** Свойства выбранного на схеме объекта: компонента, платы или провода. */
export function PropertiesPanel() {
  const selection = useCircuitStore((state) => state.selection);
  const total = selection.componentIds.length + selection.connectionIds.length;
  if (total === 0) {
    return <p className="px-3 py-3 text-[13px] text-muted-foreground">{t("properties.empty")}</p>;
  }
  const [componentId] = selection.componentIds;
  const [connectionId] = selection.connectionIds;
  if (total === 1 && componentId !== undefined) {
    return <ComponentProperties key={componentId} id={componentId} />;
  }
  if (total === 1 && connectionId !== undefined) {
    return <ConnectionProperties key={connectionId} id={connectionId} />;
  }
  return (
    <div className="flex flex-col gap-2 px-3 py-3">
      <p className="text-[13px]">{t("properties.multiple", { count: String(total) })}</p>
      <Button
        type="button"
        size="xs"
        variant="secondary"
        className="self-start"
        onClick={() => {
          useCircuitStore.getState().deleteSelection();
        }}
      >
        <Trash2 aria-hidden="true" />
        {t("properties.delete")}
      </Button>
    </div>
  );
}
