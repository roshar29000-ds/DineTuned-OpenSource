export const DEMO_SESSION_KEY = 'dinetuned-guided-demo-active';

export function enterDemoExplore() {
  sessionStorage.setItem(DEMO_SESSION_KEY, '1');
  window.location.assign('/discover');
}

export function leaveDemoExplore() {
  sessionStorage.removeItem(DEMO_SESSION_KEY);
  window.location.assign('/discover');
}

export function restartDemo() {
  for (const key of [DEMO_SESSION_KEY, 'dinetuned-guided-demo-state', 'dinetuned-guided-demo-journey',
    'dinetuned-demo-kitchen-pending', 'dinetuned-dining-v1:demo']) sessionStorage.removeItem(key);
  window.location.assign('/demo');
}
