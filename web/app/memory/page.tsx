'use client';
import { DiningDiary } from '../../components/memory/DiningDiary';
import { ButtonLink, Eyebrow, Icon } from '../../components/UI';
import { CloudMemoryStatus } from '../../components/memory/CloudMemoryStatus';

export default function Memory() {
  return <main className="content-width page-padding">
    <div className="memory-heading"><Eyebrow>YOUR FOOD STORY</Eyebrow><h1>Good meals are worth <em>remembering.</em></h1><p>The dishes you tried. The little things you loved.</p></div>
    <CloudMemoryStatus/>
    <DiningDiary/>
    <section className="memory-invite"><div><Icon name="spark" size={25}/><h2>A story that keeps growing.</h2><p>Your own words, kept with their original dining context. Cloud-connected dining actions are saved privately; every record shows its storage status. Meta-based interpretation and learning come later.</p></div>
      <ButtonLink href="/taste" variant="outline">See Taste DNA <Icon name="arrow" size={17}/></ButtonLink></section>
  </main>;
}
