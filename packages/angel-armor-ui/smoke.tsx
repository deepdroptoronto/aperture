import { renderToStaticMarkup } from 'react-dom/server';
import { Mascot, MoneyRain, WatchPager } from './src/index';

/**
 * Server-render smoke check for the UI cassette.
 *
 * This runs in Node with no DOM: it proves every component mounts without
 * touching `window` at module scope, that props reach the markup, and that
 * MoneyRain starts unmounted when inactive. It is not a browser test; canvas
 * animation is not exercised here.
 */

let failures = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`ok   ${name}`);
    return;
  }
  failures += 1;
  console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
}

const idle = renderToStaticMarkup(<Mascot state="idle" />);
check('Mascot renders', idle.includes('data-aperture-ui="mascot"'));
check('Mascot exposes an accessible label', idle.includes('role="img"') && idle.includes('aria-label='));
check('Mascot idle state is in the markup', idle.includes('data-state="idle"'));
check('Mascot ships scoped keyframes', idle.includes('@keyframes'));

const celebrate = renderToStaticMarkup(<Mascot state="celebrate" label="party time" size={140} />);
check('Mascot celebrate state and label', celebrate.includes('data-state="celebrate"') && celebrate.includes('party time'));
check('Mascot honours the size prop', celebrate.includes('width:140px'));

const staticMascot = renderToStaticMarkup(<Mascot disableAnimations />);
check('Mascot can render a static pose', staticMascot.includes('static'));

const pager = renderToStaticMarkup(
  <WatchPager
    pages={['alpha', 'beta', 'gamma']}
    ariaLabel="Demo pages"
    renderPage={(page, index) => <span>{`${page}-${index}`}</span>}
  />,
);
check('WatchPager renders one slide per page', (pager.match(/aria-roledescription="slide"/g) ?? []).length === 3);
check('WatchPager uses CSS scroll snap', pager.includes('scroll-snap-type:x mandatory'));
check('WatchPager renders page content', pager.includes('alpha-0') && pager.includes('gamma-2'));
check('WatchPager marks the first slide active', pager.includes('data-active="true"'));
check('WatchPager renders dot controls', (pager.match(/role="tab"/g) ?? []).length === 3);

const emptyPager = renderToStaticMarkup(<WatchPager pages={[]} renderPage={() => null} />);
check('WatchPager renders nothing for zero pages', emptyPager === '');

const inactiveRain = renderToStaticMarkup(<MoneyRain active={false} />);
check('MoneyRain renders nothing while inactive', inactiveRain === '');

const activeRain = renderToStaticMarkup(<MoneyRain />);
check('MoneyRain renders a canvas overlay', activeRain.includes('<canvas') && activeRain.includes('data-aperture-ui="money-rain"'));
check('MoneyRain never intercepts pointer events', activeRain.includes('pointer-events:none'));
check('MoneyRain is hidden from assistive tech', activeRain.includes('aria-hidden="true"'));

if (failures > 0) {
  console.error(`\n${failures} smoke check(s) failed`);
  process.exit(1);
}

console.log('\nAll UI cassette smoke checks passed');
