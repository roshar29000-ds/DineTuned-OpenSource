"""Explicit guided answers, not natural-language inference or active learning."""
from datetime import datetime, timezone
from ..schemas import TasteAnswers, TasteAxes, TasteProfile

def guided_profile(answers: TasteAnswers) -> TasteProfile:
    axes = TasteAxes(
        spice={"mild": .18, "medium": .55, "hot": .89}[answers.heat],
        richness={"comfort": .87, "fresh": .30, "balanced": .55}[answers.style],
        freshness={"comfort": .35, "fresh": .91, "balanced": .55}[answers.style],
        crunch={"crunchy": .89, "soft": .22, "both": .55}[answers.texture],
    )
    # Record free text verbatim; never reverse a dislike through keyword matching.
    return TasteProfile(complete=True, favorites=answers.favorites.strip(), axes=axes, exploration=answers.exploration,
                        dietary_restrictions=answers.dietary_restrictions, allergies=answers.allergies,
                        updated_at=datetime.now(timezone.utc), source="guided_demo")
