"""Evidence-based demo scoring. Points are deterministic heuristics, never probabilities.

Quality admission is independent of price and session bonuses. Thresholds are
conservative demo choices, not validated taste-prediction confidence levels.
"""
from dataclasses import dataclass
import re
from typing import Literal
from ..schemas import MenuItem, RecommendationRequest, RecommendationEvidence, TasteCompatibility

AXIS_WORDS = {
    "spice": ("gentle heat", "moderate heat", "bold heat"),
    "richness": ("a lighter character", "balanced richness", "richness"),
    "freshness": ("a mellow character", "some brightness", "freshness"),
    "crunch": ("softer textures", "a mix of textures", "crunch"),
    "aromatic": ("subtle aromatics", "balanced aromatics", "pronounced aromatics"),
    "sweetness": ("low sweetness", "moderate sweetness", "sweetness"),
    "umami": ("delicate savory notes", "balanced savoriness", "deep savoriness"),
}
AXIS_LABELS = {"spice": "heat", "crunch": "crunch", "aromatic": "aromatic intensity", "umami": "savoriness"}
INGREDIENT_TERMS = {
    "citrus": ("lime", "lemon", "citrus"), "herbs": ("herbs", "basil", "mint", "cilantro"),
    "mushrooms": ("mushroom", "mushrooms"), "garlic": ("garlic",),
    "cheese": ("cheese", "parmesan", "paneer", "burrata"), "sweet": ("sweet", "honey", "sugar"),
    "chili": ("chili", "chipotle"), "fermented": ("miso", "fermented"),
}
FAMILIES = {"ramen": "noodle-and-broth dishes", "tacos": "tacos", "curry": "curries", "pasta": "pasta", "salad": "salads", "grill": "grilled dishes"}
TEXTURES = {"crisp": "crisp textures", "silky": "silky textures", "chewy": "springy, chewy textures", "tender": "tender textures"}
COOKING = {"grilled": "grilled", "roasted": "roasted", "fried": "fried", "braised": "braised", "steamed": "steamed", "raw": "uncooked"}

def words(axis: str, value: float) -> str:
    return AXIS_WORDS[axis][0 if value < .34 else 2 if value > .66 else 1]

def matching_axes(item, profile):
    return sorted([(axis, value, abs(value - getattr(profile.axes, axis)))
        for axis, value in item.sensory.model_dump().items()
        if value is not None and getattr(profile.axes, axis) is not None], key=lambda entry: (entry[2], entry[0]))

@dataclass(frozen=True)
class RankedDish:
    dish: MenuItem
    qualified: bool
    score: int
    why: str
    compatibility: TasteCompatibility
    rejection_reason: Literal["insufficient_evidence", "poor_match"] | None

def rank_dish(item: MenuItem, req: RecommendationRequest) -> RankedDish:
    profile, notes, context, options = req.profile, req.taste_evidence, req.constraints, req.options
    axes = matching_axes(item, profile)
    weighted = [(round((1 - difference) * 1000), 6 if axis in notes.inferred_axes else 10) for axis, _, difference in axes]
    core = round(sum(value * weight for value, weight in weighted) / sum(weight for _, weight in weighted)) if weighted else 0
    close = [(axis, value, diff) for axis, value, diff in axes if diff <= .3]
    shared_axes = {axis for axis, _, _ in axes}
    evidence: list[RecommendationEvidence] = []
    connections: list[str] = []
    independent_features = 0
    def add(kind, preference, observation, related_axis=None):
        nonlocal independent_features
        evidence.append(RecommendationEvidence(kind=kind, preference=preference, observation=observation))
        # A crisp-texture note and its crunch value are the same clue, not two.
        if kind in {"favorite", "texture", "cooking", "ingredient"} and related_axis not in shared_axes:
            independent_features += 1
    features = item.features
    if features.family and features.family in notes.favorite_dishes:
        add("favorite", f"A connection to your favorite {FAMILIES[features.family]}.", f"The sample menu places {item.name} in that dish family; this is a broad connection, not an identical flavor.")
        connections.append(f"This connects with the {FAMILIES[features.family]} you enjoy, while bringing its own character.")
    for texture in sorted(set(notes.textures) & set(features.textures)):
        add("texture", f"You enjoy {TEXTURES[texture]}.", f"The dish description supports {TEXTURES[texture]}.",
            related_axis="crunch" if texture != "chewy" else None)
        connections.append(f"Its described {TEXTURES[texture]} speak to the textures you enjoy.")
    for method in sorted(set(notes.cooking_methods) & set(features.cooking_methods)):
        add("cooking", f"You enjoy {COOKING[method]} preparations.", f"The menu describes a {COOKING[method]} preparation.",
            related_axis={"fried": "crunch", "braised": "richness", "raw": "freshness"}.get(method))
        connections.append(f"The listed {COOKING[method]} preparation connects with your preferred cooking styles.")
    text = " ".join([item.description, *item.ingredients]).casefold()
    mentioned = {key: [term for term in terms if re.search(r"\b" + re.escape(term) + r"\b", text)] for key, terms in INGREDIENT_TERMS.items()}
    mentioned = {key: terms for key, terms in mentioned.items() if terms}
    disliked = sorted(set(notes.disliked_ingredients) & mentioned.keys())
    for ingredient in sorted((set(notes.liked_ingredients) - set(notes.disliked_ingredients)) & mentioned.keys()):
        listed = ", ".join(mentioned[ingredient])
        add("ingredient", f"You enjoy {ingredient.replace('_', ' ')}.", f"The sample explicitly lists {listed}, supporting this ingredient connection.",
            related_axis={"citrus": "freshness", "herbs": "aromatic", "mushrooms": "umami", "garlic": "aromatic",
                "cheese": "richness", "sweet": "sweetness", "chili": "spice", "fermented": "umami"}.get(ingredient))
        connections.append(f"The listed {listed} connect with your liking for {ingredient}.")
    feature_count = len(evidence)
    if not axes and feature_count >= 3:
        core = 760
    # Session cravings and price can never rescue a weak persistent-taste fit.
    # Preserve the detailed-profile and evidence-only policies. For one known
    # dimension, a second independent connection can come from saved dish notes.
    # Unknown axes neither reduce closeness nor become invented neutral values.
    mixed_evidence = len(axes) == 1 and independent_features >= 1
    sufficient = len(axes) >= 2 or mixed_evidence or (not axes and feature_count >= 3)
    supported = ((len(axes) >= 2 and len(close) >= 2 and core >= 720)
        or (len(axes) >= 2 and core >= 750 and feature_count >= 2)
        or (mixed_evidence and core >= 750) or (not axes and feature_count >= 3))
    conflict = bool(disliked) or any(diff >= .7 for _, _, diff in axes)
    qualified = supported and not conflict
    rejection_reason = None if qualified else "poor_match" if conflict or sufficient else "insufficient_evidence"
    sensory_evidence = []
    for axis, value, _ in close:
        sensory_evidence.append(RecommendationEvidence(kind="sensory",
            preference=f"{'Your Taste DNA suggests' if axis in notes.inferred_axes else 'Your taste setting favors'} {words(axis, getattr(profile.axes, axis))}.",
            observation=f"The curated menu attributes describe {words(axis, value)}."))
    evidence = [*evidence[:2], *sensory_evidence[:2], *evidence[2:], *sensory_evidence[2:]]
    bonus = min(feature_count, 3) * 45
    mood_axis = {"cozy": "richness", "fresh": "freshness", "bold": "spice"}.get(context.mood)
    if mood_axis and (value := getattr(item.sensory, mood_axis)) is not None:
        bonus += round(value * 40)
        if value >= .65:
            add("session", f"Today you're in a {context.mood} mood.", f"The sample's {AXIS_LABELS.get(mood_axis, mood_axis)} supports that direction.")
    if context.appetite != "any":
        bonus += 35 if item.portion == context.appetite else -25
        if item.portion == context.appetite:
            add("session", f"You asked for a {context.appetite} dish.", f"This fixture is marked as a {item.portion} portion.")
    if options.protein_preference != "any" and features.protein is not None:
        bonus += 50 if features.protein == options.protein_preference else -50
        if features.protein == options.protein_preference:
            add("session", f"You're leaning toward {options.protein_preference.replace('_', '-')} today.", "The listed protein annotation matches that temporary preference.")
    bonus += round((1 - abs(item.novelty - profile.exploration)) * 35)
    score = core + bonus - 220 * len(disliked)
    differences = [f"Expect {'more' if value > getattr(profile.axes, axis) else 'less'} {AXIS_LABELS.get(axis, axis)} than your current taste setting."
        for axis, value, diff in sorted(axes, key=lambda a: (-a[2], a[0])) if diff > .3][:2]
    if options.protein_preference != "any" and features.protein != options.protein_preference:
        differences.append("The listed protein does not establish a match to today's protein preference; it remains a soft preference.")
    if context.appetite != "any" and item.portion != context.appetite:
        differences.append(f"The sample marks this as a {item.portion} portion, different from today's appetite choice.")
    uncertainties = ["Curated demo attributes and rule-based comparisons, not a calibrated prediction or an allergy-safety claim."]
    if len(axes) < 2:
        uncertainties.append("Limited taste coverage: this connection uses saved dish notes and at most one shared sensory dimension. Other preferences remain unknown.")
    unknown = [AXIS_LABELS.get(axis, axis) for axis, value in profile.axes.model_dump().items() if value is None or getattr(item.sensory, axis) is None]
    if unknown:
        uncertainties.append("Not enough shared evidence for " + ", ".join(unknown) + ".")
    if notes.cooking_methods and not features.cooking_methods:
        uncertainties.append("The menu does not document a matching cooking method.")
    if notes.disliked_ingredients:
        uncertainties.append("Only explicitly mentioned dislikes were checked; missing ingredient details do not prove absence.")
    if profile.favorites and not notes.favorite_dishes:
        uncertainties.append("Legacy free-text favorites are retained but are not interpreted by this demo ranker.")
    if close:
        flavor = " and ".join(words(axis, value) for axis, value, _ in close[:2])
        connections.insert(1 if connections else 0, f"The sample profile shows {flavor}, close to your saved taste settings.")
    why = " ".join(connections[:2]) if connections else "We need more shared taste evidence to explain a personal connection."
    connection_summary = "Close on " + ", ".join(AXIS_LABELS.get(axis, axis) for axis, _, _ in close[:3]) + "." if close else f"Supported by {feature_count} saved dish notes; sensory fit remains unknown."
    compatibility = TasteCompatibility(label="Strong alignment" if core >= 850 and len(close) >= 3 else "Thoughtful match",
        description=connection_summary,
        score=score, evidence=evidence[:6], uncertainties=uncertainties, differences=differences)
    return RankedDish(item, qualified, score, why, compatibility, rejection_reason)
