"""Fact comparison semantics, not recommendation scores or culinary inference."""
from ..schemas import AXES, BridgeFact


def intensity_band(value: float) -> int:
    # The same qualitative bands used in existing demo sensory descriptions.
    return 0 if value < .34 else 2 if value > .66 else 1


def supported_relation(left: BridgeFact, right: BridgeFact) -> str | None:
    if left.attribute != right.attribute or left.attribute == "liked":
        return None
    if left.attribute in AXES:
        if not isinstance(left.value, (int, float)) or not isinstance(right.value, (int, float)):
            return None
        a, b = intensity_band(left.value), intensity_band(right.value)
        return "shared" if a == b else "higher" if b > a else "lower"
    if left.value == right.value:
        return "shared"
    # Different listed ingredients do not prove either dish lacks the other's.
    return "different" if left.attribute in {"family", "texture", "cooking"} else None
