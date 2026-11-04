'use client';
import { useId } from 'react';
import type { TasteAxes } from '../../lib/contracts';
import { axisLabels, axisNames, type Axis } from '../../lib/preferences';

const position = (index: number, radius: number) => {
  const angle = index * Math.PI * 2 / 7 - Math.PI / 2;
  return [200 + Math.cos(angle) * radius, 185 + Math.sin(angle) * radius];
};
const points = (radius: number) => axisNames.map((_, index) => position(index, radius).join(',')).join(' ');

/** Unknown dimensions stay empty. They are never plotted as a zero preference. */
export function SensoryMap({ axes, selected, onSelect, compact = false }: {
  axes: TasteAxes; selected?: Axis; onSelect?: (axis: Axis) => void; compact?: boolean;
}) {
  const id = useId().replace(/:/g, '');
  return <div className={'v3-sensory-map' + (compact ? ' is-compact' : '')}>
    <svg viewBox="0 0 400 375" role={onSelect ? 'group' : 'img'} aria-label="Sensory preference map. Dashed dimensions are unknown.">
      <defs><radialGradient id={id}><stop stopColor="#d2dc9a" stopOpacity=".19"/><stop offset="1" stopColor="#d2dc9a" stopOpacity="0"/></radialGradient></defs>
      <circle cx="200" cy="185" r="150" fill={`url(#${id})`}/>
      {[.25, .5, .75, 1].map(level => <polygon key={level} points={points(116 * level)} className="v3-map-grid"/>)}
      {axisNames.map((axis, index) => {
        const value = axes[axis], end = position(index, 116), label = position(index, 148);
        const dot = value === null ? end : position(index, 116 * value);
        const next = axes[axisNames[(index + 1) % 7]];
        const nextDot = next === null ? null : position((index + 1) % 7, 116 * next);
        return <g key={axis} className={'v3-map-axis' + (selected === axis ? ' active' : '')}
          role={onSelect ? 'button' : undefined} tabIndex={onSelect ? 0 : undefined}
          aria-label={`${axisLabels[axis]}: ${value === null ? 'unknown' : Math.round(value * 100) + ' out of 100'}${onSelect ? '. Inspect evidence' : ''}`}
          aria-pressed={onSelect ? selected === axis : undefined} onClick={() => onSelect?.(axis)}
          onKeyDown={event => { if (onSelect && ['Enter', ' '].includes(event.key)) { event.preventDefault(); onSelect(axis); } }}>
          <line x1="200" y1="185" x2={end[0]} y2={end[1]} className="v3-map-spoke"/>
          {value !== null && <line x1="200" y1="185" x2={dot[0]} y2={dot[1]} className="v3-map-value"/>}
          {value !== null && nextDot && <line x1={dot[0]} y1={dot[1]} x2={nextDot[0]} y2={nextDot[1]} className="v3-map-contour"/>}
          <circle cx={dot[0]} cy={dot[1]} r={selected === axis ? 6 : 4} className={value === null ? 'v3-map-unknown' : 'v3-map-dot'}/>
          <rect x={label[0]-38} y={label[1]-17} width="76" height="41" rx="8" fill="transparent"/>
          <text x={label[0]} y={label[1]-2} textAnchor="middle" className="v3-map-label">{axisLabels[axis]}</text>
          <text x={label[0]} y={label[1]+14} textAnchor="middle" className="v3-map-number">{value === null ? 'OPEN' : Math.round(value * 100)}</text>
        </g>;
      })}
      <circle cx="200" cy="185" r="3" fill="currentColor"/>
    </svg>
  </div>;
}
