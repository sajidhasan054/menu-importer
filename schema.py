from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Amount = Annotated[Decimal, Field(ge=0, max_digits=12, decimal_places=2)]
Positive = Annotated[int, Field(gt=0)]
Level = Annotated[int, Field(ge=0, le=5)]
Currency = Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}$")]


class Record(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Variant(Record):
    label: str | None = None
    price_amount: Amount | None = None
    price_type: Literal["fixed", "from", "market", "unknown"] = "unknown"
    currency: Currency
    pieces: Positive | None = None
    weight_g: Positive | None = None
    volume_ml: Positive | None = None
    serves_min: Positive | None = None
    serves_max: Positive | None = None
    availability: Literal["available", "sold_out", "seasonal"] | None = None

    @model_validator(mode="after")
    def check_variant(self):
        if (self.price_type in ("fixed", "from")) != (self.price_amount is not None):
            raise ValueError("Fixed and starting prices require an amount. Market and unknown prices leave it blank.")
        if self.serves_min and self.serves_max and self.serves_min > self.serves_max:
            raise ValueError("Maximum servings must be at least the minimum.")
        return self


class Source(Record):
    locator: str
    raw_text: str


class Item(Record):
    name: Name
    name_bn: str | None = None
    section: str | None = None
    description: str | None = None
    description_bn: str | None = None
    cuisine_tags: list[str] | None = None
    item_type: str | None = None
    spice_level: Level | None = None
    sweetness_level: Level | None = None
    dietary_tags: list[str] | None = None
    allergen_tags: list[str] | None = None
    variants: list[Variant] = Field(min_length=1)
    sources: list[Source] = Field(default_factory=list)


class Menu(Record):
    schema_version: Literal["1.0"] = "1.0"
    restaurant_name: Name
    branch_name: Name
    default_currency: Currency = "BDT"
    items: list[Item] = Field(default_factory=list)
