"""Геометрия схемы: положение выводов в единицах сетки с учётом поворота.

Правило то же, что во frontend: поворот по часовой стрелке, повёрнутый символ снова
вписывается в прямоугольник с левым верхним углом в ``position`` экземпляра, поэтому
целые координаты выводов остаются целыми.
"""

from microlab_api.circuit_schema.generated.circuit import GridPoint
from microlab_api.circuit_schema.generated.component_definition import (
    ComponentDefinition,
    PinPosition,
    VisualModel,
)

type Point = tuple[int, int]


def rotate_point(point: PinPosition, visual: VisualModel, rotation: int) -> Point:
    width, height = visual.width, visual.height
    match rotation:
        case 90:
            return (height - point.y, point.x)
        case 180:
            return (width - point.x, height - point.y)
        case 270:
            return (point.y, width - point.x)
        case _:
            return (point.x, point.y)


def pin_positions(
    definition: ComponentDefinition, position: GridPoint | None, rotation: int | None
) -> dict[str, Point]:
    """Абсолютные координаты всех выводов экземпляра (плата: position/rotation по умолчанию)."""
    origin_x, origin_y = (position.x, position.y) if position is not None else (0, 0)
    result: dict[str, Point] = {}
    for pin in definition.pins:
        local = definition.visual.pins.get(pin.id)
        if local is None:
            continue
        x, y = rotate_point(local, definition.visual, rotation or 0)
        result[pin.id] = (origin_x + x, origin_y + y)
    return result
