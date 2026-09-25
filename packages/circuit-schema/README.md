# @microlab/circuit-schema

Единственный источник истины для формата схемы и определений компонентов MicroLab.
Формат языконезависимый: JSON Schema (draft 2020-12) и JSON-данные.

```text
schema/circuit.schema.json               документ схемы (schemaVersion 1)
schema/component-definition.schema.json  определение компонента или платы
definitions/*.json                       arduino-uno-r3, breadboard, resistor, led, push-button
examples/*.json                          примеры документов схемы (используются в тестах)
examples/netlists/*.json                 эталонный netlist примеров (общий для backend и frontend)
src/generated/                           TypeScript: типы и определения (генерируется)
src/index.ts                             COMPONENT_DEFINITIONS, getComponentDefinition(type)
```

Координаты — в единицах сетки: целые числа, 1 единица = 2,54 мм (0,1 дюйма). Поворот — по часовой стрелке; повёрнутый символ вписывается в прямоугольник с левым верхним углом в `position`, поэтому выводы остаются в целых координатах.

## Соединения

Узел (net) образуют провода (`connections`), внутренние соединения определения
(`internalConnections`) и совпадение по сетке с гнездом: вывод компонента, лежащий точно
в точке вывода компонента с `socket: true` (отверстие макетной платы), соединён с ним.
Выводы платы и других гнёзд так не соединяются; близость без совпадения — не соединение.
Узлы из одних выводов гнёзд (пустые полосы) в netlist не выводятся.

Макетная плата: 30 столбцов, в каждом a–e и f–j — два узла (канавка между e и f — 3 шага),
четыре шины по 25 контактов (tp/tn сверху, bn/bp снизу), каждая — один сплошной узел.

`electricalModel` (resistor / led / switch) и `board.electricalLimits` используются
проверкой схемы: рабочий предел тока GPIO и суммы по группам портов, не absolute maximum.

## Генерация

Сгенерированные файлы коммитятся и проверяются в CI; вручную их не правят.

```sh
pnpm gen:circuit-schema            # TypeScript (json-schema-to-typescript)
pnpm gen:circuit-schema:check
cd apps/api
uv run python -m microlab_api.scripts.gen_circuit_schema          # Pydantic (datamodel-code-generator)
uv run python -m microlab_api.scripts.gen_circuit_schema --check
```

Backend читает `definitions/*.json` во время выполнения из checkout репозитория.
В TypeScript определения встраиваются в `src/generated/definitions.ts` с аннотацией
типа, поэтому `tsc` проверяет их по сгенерированным типам; backend-тесты проверяют их по
JSON Schema и на внутреннюю согласованность.

## Аппаратные данные

Pin mapping, возможности выводов и параметры платы UNO R3 взяты только из сверенных
официальных источников (распиновка и схема UNO R3, datasheet ATmega328P, ядро
`arduino:avr` 1.8.8). Непроверенные сведения в определения не добавляются.
