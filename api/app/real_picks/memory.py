"""Small, user-scoped Taste Memory projection for real-menu reasoning.

Reports are the diner's observations, never verified restaurant ingredients.
Saving/selecting/ordering never implies liking or consumption.
"""
from uuid import UUID
from ..culinary.errors import CulinaryError
from ..persistence.config import PersistenceError
from .models import RealMemoryObservation


def load_memory(repo, user_id: UUID):
    try:
        reports, events = repo.evidence(0), repo.events(0)
    except PersistenceError:
        return (), 'Cloud Taste Memory could not be read; this selection uses current Taste DNA only.'
    observations = []
    for report in reports[:4]:
        feedback, event = report.feedback, report.event
        if feedback.user_id != user_id or event and event.user_id != user_id:
            raise CulinaryError('memory_identity', 'Dining history ownership could not be verified.')
        value = feedback.feedback
        contradiction = (feedback.rating is not None and
            (feedback.rating <= 2 and value.liked or feedback.rating >= 4 and not value.liked))
        polarity = 'neutral' if contradiction else 'like' if value.liked else 'dislike'
        label = f'You reported {"liking" if value.liked else "disliking"} {value.dish_name}'
        if feedback.rating is not None: label += f' ({feedback.rating}/5)'
        if value.note.strip(): label += f'; your note: “{value.note.strip()}”'
        if contradiction: label += '; rating and like/dislike conflict, so this is not a taste anchor'
        observations.append(RealMemoryObservation(id='feedback_'+feedback.id.hex, label=label,
            kind='feedback', polarity=polarity, restaurant_id=value.restaurant_id or 'unknown',
            menu_version=value.menu_version or 'unknown', dish_id=value.dish_id,
            consumption_confirmed=report.consumption_confirmed))
    for event in events[:2]:
        if event.user_id != user_id:
            raise CulinaryError('memory_identity', 'Dining history ownership could not be verified.')
        label = {'saved': 'Saved for later', 'selected': 'Considered',
            'ordered': 'Confirmed an order of', 'tasted': 'Confirmed trying'}[event.event_type]
        observations.append(RealMemoryObservation(id='event_'+event.id.hex,
            label=f'{label} {event.dish_name or event.dish_id}; enjoyment was not inferred.',
            kind=event.event_type, polarity='neutral', restaurant_id=event.restaurant_id,
            menu_version=event.menu_version, dish_id=event.dish_id,
            consumption_confirmed=event.event_type == 'tasted'))
    return tuple(observations), None
