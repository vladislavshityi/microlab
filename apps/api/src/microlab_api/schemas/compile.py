"""Модели API компиляции скетча."""

from typing import Literal

from pydantic import Field

from microlab_api.schemas.base import ApiModel


class CompileRequest(ApiModel):
    code: str = Field(description="Arduino sketch source (sketch.ino), UTF-8.")


class CompileDiagnostic(ApiModel):
    # file/line/column равны null для сообщений без привязки к исходнику
    # (например, итоговая ошибка сборки или ошибка компоновщика без строки).
    file: str | None
    line: int | None
    column: int | None
    severity: Literal["error", "warning", "note"]
    message: str


class CompileSizes(ApiModel):
    flash_bytes: int
    flash_max_bytes: int
    ram_bytes: int
    ram_max_bytes: int


class Firmware(ApiModel):
    format: Literal["ihex"]
    data: str = Field(description="Intel HEX text of the application image (without bootloader).")
    sha256: str = Field(description="SHA-256 of the Intel HEX text.")


class Toolchain(ApiModel):
    arduino_cli: str
    platform: str
    fqbn: str


class CompileResponse(ApiModel):
    status: Literal["success", "error"]
    diagnostics: list[CompileDiagnostic]
    sizes: CompileSizes | None
    firmware: Firmware | None
    compiler_output: str
    compiler_output_truncated: bool
    toolchain: Toolchain
    duration_ms: int
