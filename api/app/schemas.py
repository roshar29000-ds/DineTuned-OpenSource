"""Canonical V2 contract. TypeScript types are generated from these models."""
from datetime import datetime
from enum import Enum
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator

Unit = Annotated[float, Field(strict=True, ge=0, le=1, allow_inf_nan=False)]
Identifier = Annotated[str, Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")]

class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

class DietaryRestriction(str, Enum):
    vegetarian = "vegetarian"
    vegan = "vegan"
    pescatarian = "pescatarian"
    no_beef = "no_beef"
    no_pork = "no_pork"
    dairy_free = "dairy_free"
    gluten_free = "gluten_free"

class Allergen(str, Enum):
    milk = "milk"
    egg = "egg"
    fish = "fish"
    shellfish = "shellfish"
    tree_nut = "tree_nut"
    peanut = "peanut"
    wheat = "wheat"
    soy = "soy"
    sesame = "sesame"

class AllergyProfile(Contract):
    allergens: list[Allergen] = Field(default_factory=list, max_length=9)
    other: str = Field(default="", max_length=200)

    @model_validator(mode="after")
    def normalize(self):
        self.allergens = list(dict.fromkeys(self.allergens))
        self.other = self.other.strip()
        return self

class TasteAxes(Contract):
    # None is unknown, not medium intensity.
    spice: Unit | None = None
    richness: Unit | None = None
    freshness: Unit | None = None
    crunch: Unit | None = None
    aromatic: Unit | None = None
    sweetness: Unit | None = None
    umami: Unit | None = None

class TasteProfile(Contract):
    schema_version: Literal[2] = 2
    complete: bool = False
    favorites: str = Field(default="", max_length=2000)
    axes: TasteAxes = Field(default_factory=TasteAxes)
    exploration: Unit = 0.5
    dietary_restrictions: list[DietaryRestriction] = Field(default_factory=list, max_length=7)
    allergies: AllergyProfile = Field(default_factory=AllergyProfile)
    updated_at: datetime | None = None
    source: Literal["guided_demo", "user_edited", "migrated"] = "guided_demo"

class TasteAnswers(Contract):
    favorites: str = Field(min_length=1, max_length=2000)
    style: Literal["comfort", "fresh", "balanced"]
    heat: Literal["mild", "medium", "hot"]
    texture: Literal["crunchy", "soft", "both"]
    exploration: Unit = 0.5
    dietary_restrictions: list[DietaryRestriction] = Field(default_factory=list, max_length=7)
    allergies: AllergyProfile = Field(default_factory=AllergyProfile)

class DiningConstraints(Contract):
    max_price_minor: Annotated[int, Field(strict=True, ge=0, le=100000)] = 3000
    currency: Literal["USD"] = "USD"
    dietary_restrictions: list[DietaryRestriction] = Field(default_factory=list, max_length=7)
    allergies: AllergyProfile = Field(default_factory=AllergyProfile)
    mood: Literal["open", "cozy", "fresh", "bold"] = "open"
    appetite: Literal["any", "light", "hearty"] = "any"

class Price(Contract):
    amount_minor: Annotated[int, Field(strict=True, ge=0, le=100000)] | None
    currency: Literal["USD"] = "USD"
    status: Literal["listed", "unknown"] = "listed"
    basis: Literal["per_dish_before_tax_tip"] = "per_dish_before_tax_tip"

    @model_validator(mode="after")
    def price_matches_status(self):
        if (self.status == "unknown") != (self.amount_minor is None):
            raise ValueError("Unknown prices must have no amount; listed prices require an amount")
        return self

class MediaAsset(Contract):
    kind: Literal["placeholder"] = "placeholder"
    motif: Literal["noodles", "bowl", "rolls", "toast", "tacos", "corn", "rice", "pasta", "salad", "plate", "dumplings", "curry", "skewers"]
    label: str = "Menu illustration · not a dish photograph"
    accent: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")

class DietaryEvidence(Contract):
    restriction: DietaryRestriction
    status: Literal["supported", "conflict", "unknown"]
    source: Literal["curated_demo"] = "curated_demo"

class AllergenEvidence(Contract):
    contains: list[Allergen] = Field(default_factory=list)
    may_contain: list[Allergen] = Field(default_factory=list)
    information_status: Literal["unknown", "partial", "documented"] = "unknown"
    cross_contact: Literal["unknown", "reported_risk", "documented_controls"] = "unknown"
    note: str = "Incomplete sample ingredient information. Confirm ingredients and cross-contact with restaurant staff."

class MenuItem(Contract):
    id: Identifier
    category_id: Identifier
    name: str
    description: str
    price: Price
    ingredients: list[str]
    labels: list[str]
    dietary: list[DietaryEvidence]
    allergens: AllergenEvidence
    media: MediaAsset
    sensory: TasteAxes
    novelty: Unit
    portion: Literal["light", "hearty"]
    available: bool = True
    features: "DishFeatures" = Field(default_factory=lambda: DishFeatures())

Protein = Literal["chicken", "beef", "pork", "seafood", "plant_forward"]
Texture = Literal["crisp", "silky", "chewy", "tender"]
CookingMethod = Literal["grilled", "roasted", "fried", "braised", "steamed", "raw"]
IngredientPreference = Literal["citrus", "herbs", "mushrooms", "garlic", "cheese", "sweet", "chili", "fermented"]
FavoriteDish = Literal["tacos", "ramen", "curry", "pasta", "salad", "grill"]
SensoryAxis = Literal["spice", "richness", "freshness", "crunch", "aromatic", "sweetness", "umami"]

class DishFeatures(Contract):
    # Explicit fixture annotations, never proof of ingredients or allergen safety.
    protein: Protein | None = None
    family: FavoriteDish | None = None
    textures: list[Texture] = Field(default_factory=list, max_length=4)
    cooking_methods: list[CookingMethod] = Field(default_factory=list, max_length=6)
    source: Literal["curated_demo"] = "curated_demo"

class MenuCategory(Contract):
    id: Identifier
    name: str
    description: str
    items: list[MenuItem]

class RestaurantSummary(Contract):
    id: Identifier
    name: str
    cuisine: str
    area: str
    city: str = "Chicago"
    subtitle: str
    price_label: str
    accent: str
    is_demo: Literal[True] = True
    distance_km: float | None = None
    item_count: int

class RestaurantSearch(Contract):
    schema_version: Literal[2] = 2
    mode: Literal["demo"] = "demo"
    restaurants: list[RestaurantSummary]
    location_applied: bool = False
    note: str = "Fictional venues and example locations. No live restaurant lookup."

class MenuSource(Contract):
    kind: Literal["demo_fixture"] = "demo_fixture"
    label: str = "Complete curated demo menu"
    completeness: Literal["complete_fixture", "partial"] = "complete_fixture"
    retrieved_at: datetime | None = None
    note: str = "Every item in this sample menu is included. Live menu parsing is not connected."

class RestaurantMenu(Contract):
    schema_version: Literal[2] = 2
    mode: Literal["demo"] = "demo"
    version: Identifier
    restaurant: RestaurantSummary
    source: MenuSource = Field(default_factory=MenuSource)
    categories: list[MenuCategory]
    total_items: int

class MenuEvaluationRequest(Contract):
    restaurant_id: Identifier
    menu_version: Identifier
    constraints: DiningConstraints

class Exclusion(Contract):
    code: Literal["budget", "price_unknown", "unavailable", "diet_conflict", "diet_unknown", "allergen_conflict", "allergen_unknown"]
    message: str

class ItemEligibility(Contract):
    item_id: Identifier
    eligible: bool
    reasons: list[Exclusion]

class MenuEvaluation(Contract):
    mode: Literal["demo"] = "demo"
    restaurant_id: Identifier
    menu_version: Identifier
    constraints: DiningConstraints
    total_count: int
    eligible_count: int
    items: list[ItemEligibility]
    recommendation_candidate_count: int = Field(default=0, ge=0)

class RecommendationTasteEvidence(Contract):
    favorite_dishes: list[FavoriteDish] = Field(default_factory=list, max_length=6)
    textures: list[Texture] = Field(default_factory=list, max_length=4)
    cooking_methods: list[CookingMethod] = Field(default_factory=list, max_length=6)
    liked_ingredients: list[IngredientPreference] = Field(default_factory=list, max_length=8)
    disliked_ingredients: list[IngredientPreference] = Field(default_factory=list, max_length=8)
    inferred_axes: list[SensoryAxis] = Field(default_factory=list, max_length=7)

class RecommendationOptions(Contract):
    protein_preference: Literal["any", "chicken", "beef", "pork", "seafood", "plant_forward"] = "any"
    include_over_budget: bool = True

RefinementPreference = Literal["less_creamy", "lighter", "spicier", "adventurous"]

class RefinementRequest(Contract):
    """Temporary meal intent, never a mutation of persistent Taste DNA."""
    preferences: list[RefinementPreference] = Field(default_factory=list, max_length=4)
    avoid_dish_ids: list[Identifier] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def unique_choices(self):
        if len(set(self.preferences)) != len(self.preferences) or len(set(self.avoid_dish_ids)) != len(self.avoid_dish_ids):
            raise ValueError("Refinement preferences and dish IDs must be unique")
        return self

class RefinementResult(Contract):
    request: RefinementRequest
    provider: str
    mode: Literal["demo", "model"] = "demo"
    status: Literal["inactive", "applied", "unchanged", "no_alternatives"]
    message: str
    limitations: list[str] = Field(default_factory=list)

class BridgeFeedback(Contract):
    """Reported feedback, not culinary facts; free-text notes are deliberately omitted."""
    id: str = Field(min_length=1, max_length=100)
    restaurant_id: Identifier
    dish_id: Identifier
    menu_version: Identifier | None = None
    liked: bool = Field(strict=True)
    date: datetime

class RecommendationRequest(MenuEvaluationRequest):
    profile: TasteProfile
    taste_evidence: RecommendationTasteEvidence = Field(default_factory=RecommendationTasteEvidence)
    options: RecommendationOptions = Field(default_factory=RecommendationOptions)
    bridge_feedback: list[BridgeFeedback] = Field(default_factory=list, max_length=20)
    refinements: RefinementRequest = Field(default_factory=RefinementRequest, json_schema_extra={"x-response-optional": True})

class TasteBridge(Contract):
    connection: str
    contrast: str
    evidence: list[str]
    uncertainty: str = "Based on curated sample attributes and your stated preferences, not a validated taste prediction."

BridgeAttribute = Literal["family", "texture", "cooking", "ingredient", "liked", "spice", "richness", "freshness", "crunch", "aromatic", "sweetness", "umami"]

class BridgeFact(Contract):
    id: Identifier
    subject: Literal["user", "target", "familiar_dish"]
    attribute: BridgeAttribute
    value: str | Unit
    label: str
    source: Literal["taste_dna", "taste_detective", "menu_fixture", "reported_feedback"]
    reference: str
    basis: Literal["stated", "inferred", "curated_demo", "reported"]
    restaurant_id: Identifier | None = None
    menu_version: Identifier | None = None
    dish_id: Identifier | None = None
    feedback_id: str | None = None

class BridgeAnchor(Contract):
    id: Identifier
    kind: Literal["saved_preferences", "liked_dish"]
    label: str
    evidence_ids: list[Identifier] = Field(max_length=80)

class BridgeLink(Contract):
    anchor_fact_id: Identifier
    target_fact_id: Identifier
    relation: Literal["shared", "higher", "lower", "different"]

class BridgeProposal(Contract):
    """Reasoner output: references and relations only. Unchecked prose is not publishable."""
    restaurant_id: Identifier
    menu_version: Identifier
    dish_id: Identifier
    anchor_id: Identifier
    shared: list[BridgeLink] = Field(min_length=1, max_length=6)
    differences: list[BridgeLink] = Field(default_factory=list, max_length=4)

class BridgeComparison(BridgeLink):
    attribute: BridgeAttribute
    text: str

class StructuredTasteBridge(Contract):
    schema_version: Literal[1] = 1
    provider: str = "structured_demo_v1"
    status: Literal["grounded", "limited", "unavailable"]
    restaurant_id: Identifier
    menu_version: Identifier
    dish_id: Identifier
    anchor: BridgeAnchor | None = None
    shared: list[BridgeComparison] = Field(default_factory=list, max_length=6)
    differences: list[BridgeComparison] = Field(default_factory=list, max_length=4)
    explanation: str = ""
    evidence: list[BridgeFact] = Field(default_factory=list, max_length=30)
    uncertainties: list[str] = Field(default_factory=list)
    unavailable_reason: Literal["insufficient_evidence", "contradictory_evidence", "ineligible", "invalid_proposal", "provider_unavailable"] | None = None

class RecommendationEvidence(Contract):
    kind: Literal["sensory", "favorite", "texture", "cooking", "ingredient", "session"]
    preference: str
    observation: str
    source: Literal["curated_demo"] = "curated_demo"

class TasteCompatibility(Contract):
    label: Literal["Strong alignment", "Thoughtful match"]
    description: str
    score: int
    score_kind: Literal["uncalibrated_demo_points"] = "uncalibrated_demo_points"
    evidence: list[RecommendationEvidence]
    uncertainties: list[str]
    differences: list[str]

class BudgetPosition(Contract):
    target_minor: Annotated[int, Field(strict=True, ge=0, le=100000)]
    overage_minor: Annotated[int, Field(strict=True, ge=0, le=100000)]
    status: Literal["within_target", "above_target"]

class PersonalizedDish(Contract):
    """Validated dish presentation shared by primary picks and additional discoveries."""
    dish: MenuItem
    why: str
    bridge: TasteBridge
    compatibility: TasteCompatibility
    budget: BudgetPosition
    taste_bridge: StructuredTasteBridge | None = None

class Recommendation(PersonalizedDish):
    category: Literal["Best match", "Comfort pick", "Discovery pick"]

class WorthTheStretchResult(Contract):
    schema_version: Literal[1] = 1
    restaurant_id: Identifier
    menu_version: Identifier
    provider: str
    mode: Literal["demo", "model"] = "demo"
    picks: list[PersonalizedDish] = Field(default_factory=list, max_length=2)

class PairingFact(Contract):
    id: Identifier
    item_id: Identifier | None = None  # None identifies saved user evidence.
    attribute: Literal["category", "portion", "ingredient", "texture", "cooking", "protein", "spice", "richness", "freshness", "crunch", "aromatic", "sweetness", "umami"]
    value: str | Unit
    label: str
    source: Literal["menu_fixture", "taste_dna", "taste_detective", "session"]
    reference: str
    basis: Literal["curated_demo", "stated", "inferred"]

class PairingLink(Contract):
    left_fact_id: Identifier
    right_fact_id: Identifier
    relation: Literal["shared", "higher", "lower", "different"]

class PairingQuote(Contract):
    item_id: Identifier
    amount_minor: Annotated[int, Field(strict=True, ge=0, le=100000)]
    currency: Literal["USD"] = "USD"

class MealPairingProposal(Contract):
    """Untrusted provider output. Prices, membership and claims are checked independently."""
    restaurant_id: Identifier
    menu_version: Identifier
    main_dish_id: Identifier
    items: list[PairingQuote] = Field(min_length=2, max_length=4)
    subtotal_minor: Annotated[int, Field(strict=True, ge=0, le=400000)]
    claims: list[PairingLink] = Field(min_length=1, max_length=12)

class PairingExplanation(PairingLink):
    text: str

class MealComponent(Contract):
    item_id: Identifier
    name: str
    category_id: Identifier
    category_name: str
    price_minor: Annotated[int, Field(strict=True, ge=0, le=100000)]
    currency: Literal["USD"] = "USD"
    budget: BudgetPosition

class MealCombination(Contract):
    id: Identifier
    restaurant_id: Identifier
    menu_version: Identifier
    main: MealComponent
    additions: list[MealComponent] = Field(min_length=1, max_length=3)
    subtotal_minor: Annotated[int, Field(strict=True, ge=0, le=400000)]
    currency: Literal["USD"] = "USD"
    price_basis: Literal["menu_subtotal_before_tax_tip_fees"] = "menu_subtotal_before_tax_tip_fees"
    budget_scope: Literal["per_dish_not_meal_cap"] = "per_dish_not_meal_cap"
    rationale: str
    claims: list[PairingExplanation] = Field(min_length=1, max_length=12)
    evidence: list[PairingFact]
    uncertainties: list[str]

class MealCombinationResult(Contract):
    schema_version: Literal[1] = 1
    restaurant_id: Identifier
    menu_version: Identifier
    provider: str
    mode: Literal["demo", "model"] = "demo"
    status: Literal["available", "limited", "unavailable"]
    combinations: list[MealCombination] = Field(default_factory=list, max_length=3)
    unavailable_reason: Literal["no_primary_picks", "insufficient_menu_evidence", "provider_unavailable", "invalid_proposal", "invalid_context"] | None = None
    uncertainties: list[str] = Field(default_factory=list)

class RecommendationSession(Contract):
    schema_version: Literal[2] = 2
    id: str
    created_at: datetime
    mode: Literal["demo"] = "demo"
    engine: Literal["deterministic-v3.4a"] = "deterministic-v3.4a"
    restaurant: RestaurantSummary
    menu_version: Identifier
    constraints: DiningConstraints
    recommendations: list[Recommendation] = Field(max_length=3)
    evaluation: MenuEvaluation
    message: str
    profile: TasteProfile
    taste_evidence: RecommendationTasteEvidence
    options: RecommendationOptions
    bridge_feedback: list[BridgeFeedback] = Field(default_factory=list, max_length=20)
    hard_eligible_count: int = Field(ge=0)
    qualified_count: int = Field(ge=0)
    within_budget_qualified_count: int = Field(ge=0)
    above_budget_qualified_count: int = Field(ge=0)
    empty_reason: Literal["hard_exclusions", "insufficient_evidence", "no_strong_matches", "over_budget_hidden", "no_alternatives"] | None = None
    # Additive response extension: older servers/fixtures may omit this field.
    meal_combinations: MealCombinationResult | None = Field(default=None, json_schema_extra={"x-response-optional": True})
    worth_the_stretch: WorthTheStretchResult | None = Field(default=None, json_schema_extra={"x-response-optional": True})
    refinement_result: RefinementResult | None = Field(default=None, json_schema_extra={"x-response-optional": True})

class MealFeedback(Contract):
    id: str = Field(min_length=1, max_length=100)
    restaurant_id: Identifier | None = None
    restaurant_name: str = Field(min_length=1, max_length=200)
    dish_id: Identifier
    dish_name: str = Field(min_length=1, max_length=200)
    liked: bool
    note: str = Field(default="", max_length=1000)
    date: datetime
    menu_version: Identifier | None = None

class Capabilities(Contract):
    schema_version: Literal[2] = 2
    status: Literal["ok"] = "ok"
    demo_mode: Literal[True] = True
    restaurant_data: Literal["fictional_fixtures"] = "fictional_fixtures"
    recommendation_engine: Literal["deterministic-v3.4a"] = "deterministic-v3.4a"
    live_meta_inference: Literal[False] = False
    live_menu_parsing: Literal[False] = False

AXES = tuple(TasteAxes.model_fields)
