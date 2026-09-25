# Сгенерировано из packages/circuit-schema. Не редактировать вручную.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field


class GridPoint(BaseModel):
    """
    Point in grid units (integers, 1 unit = 2.54 mm).
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    x: int
    y: int


class BoardInstance(BaseModel):
    """
    Board instance. position defaults to the origin, rotation to 0.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: Annotated[str, Field(pattern="^[A-Za-z][A-Za-z0-9_-]{0,63}$", title="InstanceId")]
    """
    Identifier of a board, component or connection within the document. Dots are not allowed: pin references use the form componentId.pinId.
    """
    type: Annotated[str, Field(pattern="^[a-z][a-z0-9-]{0,63}$", title="ComponentType")]
    """
    Component definition type, e.g. resistor.
    """
    position: GridPoint | None = None
    rotation: Annotated[Literal[0, 90, 180, 270] | None, Field(title="Rotation")] = None
    """
    Clockwise rotation in degrees.
    """


class ComponentInstance(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: Annotated[str, Field(pattern="^[A-Za-z][A-Za-z0-9_-]{0,63}$", title="InstanceId")]
    """
    Identifier of a board, component or connection within the document. Dots are not allowed: pin references use the form componentId.pinId.
    """
    type: Annotated[str, Field(pattern="^[a-z][a-z0-9-]{0,63}$", title="ComponentType")]
    """
    Component definition type, e.g. resistor.
    """
    position: GridPoint
    rotation: Annotated[Literal[0, 90, 180, 270], Field(title="Rotation")]
    """
    Clockwise rotation in degrees.
    """
    properties: dict[str, float | str | bool]
    """
    Property values by property id. Missing properties take the definition default.
    """


class PinRef(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    component_id: Annotated[
        str, Field(alias="componentId", pattern="^[A-Za-z][A-Za-z0-9_-]{0,63}$", title="InstanceId")
    ]
    """
    Identifier of a board, component or connection within the document. Dots are not allowed: pin references use the form componentId.pinId.
    """
    pin_id: Annotated[str, Field(alias="pinId", max_length=32, min_length=1)]


class Connection(BaseModel):
    """
    Electrical connection (wire) between two pins. Appearance never affects connectivity.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: Annotated[str, Field(pattern="^[A-Za-z][A-Za-z0-9_-]{0,63}$", title="InstanceId")]
    """
    Identifier of a board, component or connection within the document. Dots are not allowed: pin references use the form componentId.pinId.
    """
    from_: Annotated[PinRef, Field(alias="from")]
    to: PinRef
    color: Annotated[str | None, Field(pattern="^#[0-9a-fA-F]{6}$")] = None
    """
    Visual metadata only; never used for electrical behavior.
    """
    route: list[GridPoint] | None = None
    """
    Intermediate waypoints in grid units. Consecutive waypoints must be horizontal or vertical to each other.
    """


class CircuitDocument(BaseModel):
    """
    MicroLab circuit document, schemaVersion 1. Coordinates are grid units: integers, 1 unit = 2.54 mm (0.1 inch). The board is addressable in connections by its id, like any component.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    schema_version: Annotated[Literal[1], Field(alias="schemaVersion")]
    """
    Version of this document format. Any format change increments it.
    """
    board: BoardInstance
    components: list[ComponentInstance]
    connections: list[Connection]
