"""Supported factual relations, not culinary desirability or a taste score."""
from ..schemas import AXES, PairingFact
from ..tastebridge.relations import intensity_band


def supported_relation(left: PairingFact, right: PairingFact) -> str | None:
    if left.attribute != right.attribute or right.item_id is None or left.item_id == right.item_id:
        return None
    if left.attribute in AXES:
        if not isinstance(left.value, (int, float)) or not isinstance(right.value, (int, float)):
            return None
        if left.item_id is None:
            return "shared" if intensity_band(left.value) == intensity_band(right.value) else None
        return "higher" if right.value > left.value else "lower" if right.value < left.value else "shared"
    if left.attribute in {"ingredient", "texture", "cooking", "protein"} and left.value == right.value:
        return "shared"
    if left.item_id is not None and left.attribute in {"texture", "cooking"}:
        return "different"
    return None
