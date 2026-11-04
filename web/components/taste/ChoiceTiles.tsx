'use client';
import { DishArt } from '../DishArt';
import { Icon } from '../UI';
import { choices, isSingle, type ChoiceKey } from '../../lib/detective/model';

export function ChoiceTiles({ choiceKey, value, onChoose, suggestions = [] }: {
  choiceKey: ChoiceKey; value: string[]; onChoose: (id: string) => void; suggestions?: string[];
}) {
  const options = [...choices[choiceKey]].sort((a, b) => Number(suggestions.includes(b.id)) - Number(suggestions.includes(a.id)));
  return <div className={`v3-choices v3-choices-${choiceKey}`} role="group" aria-label={choiceKey === 'avoids' ? 'Ingredients to enjoy less' : 'Response choices'}>
    {options.map(option => {
      const selected = value.includes(option.id);
      const disabled = choiceKey === 'anchors' && value.length >= 3 && !selected;
      return <button type="button" key={option.id} aria-pressed={selected} disabled={disabled}
        className={'v3-choice' + (selected ? ' selected' : '') + (option.motif ? ' has-art' : '')}
        onClick={() => onChoose(option.id)} aria-label={option.label}>
        {option.motif && <DishArt name={option.label} seed={option.id} caption={false}
          media={{ kind: 'placeholder', motif: option.motif, accent: option.color!, label: 'Illustrated taste prompt' }}/>}
        <span className="v3-choice-copy"><strong>{option.label}</strong>{option.detail && <small>{option.detail}</small>}
          {suggestions.includes(option.id) && <span className="v3-suggestion">A detail to consider</span>}</span>
        <span className={'v3-choice-check' + (isSingle(choiceKey) ? ' is-radio' : '')} aria-hidden="true">{selected && <Icon name="check" size={13}/>}</span>
      </button>;
    })}
  </div>;
}
