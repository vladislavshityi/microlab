import uuid

from sqlalchemy import Text, Uuid, text
from sqlalchemy.orm import Mapped, mapped_column

from microlab_api.models.base import Base, TimestampMixin


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, server_default=text("gen_random_uuid()")
    )
    username: Mapped[str] = mapped_column(Text, unique=True)
