// End-to-end check of the production build: password gate, then "Simulate cost change" in Category-Item
// Summary and Item Cost Over Time must open the simulator with the item prefilled.
//
//   npm run test:e2e                         builds, serves dist with `vite preview`, runs the checks
//   BASE_URL=https://… node scripts/e2e.mjs  runs the same checks against a deployed URL
//
// No dependencies: drives a local Chrome / Chromium over the DevTools protocol (set CHROME_PATH if needed).
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PASSWORD = process.env.E2E_PASSWORD ?? 'BC2demo';
const PORT = 4173;
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const children = [];
const profile = mkdtempSync(join(tmpdir(), 'uc2-e2e-'));

async function cleanup() {
  for (const c of children) c.kill();
  await sleep(500);
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    /* the OS cleans temp folders */
  }
}

async function waitFor(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return r;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function main() {
  let base = process.env.BASE_URL?.replace(/\/$/, '');
  if (!base) {
    if (!existsSync('dist/index.html')) throw new Error('dist/ is missing: run `npm run build` first (npm run test:e2e does it).');
    children.push(spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' }));
    base = `http://localhost:${PORT}`;
    await waitFor(`${base}/`);
  }
  const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!chromePath) throw new Error('Chrome not found: set CHROME_PATH.');
  children.push(spawn(chromePath, ['--headless=new', '--remote-debugging-port=9335', `--user-data-dir=${profile}`, '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' }));
  const target = (await (await waitFor('http://127.0.0.1:9335/json')).json()).find((t) => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
  });
  const send = (method, params = {}) =>
    new Promise((r) => {
      const i = ++id;
      pending.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const until = async (expression, what, ms = 15000) => {
    for (let t = 0; t < ms; t += 200) {
      const v = await evaluate(expression);
      if (v) return v;
      await sleep(200);
    }
    throw new Error(`Timed out: ${what}`);
  };
  await send('Runtime.enable');
  await send('Page.enable');

  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok, detail });
    console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` · ${detail}` : ''}`);
  };

  // 1. Password gate.
  await send('Page.navigate', { url: `${base}/?tab=items&item=4123` });
  await until(`!!document.querySelector('input[type=password]')`, 'password field');
  await evaluate(`(() => {
    const i = document.querySelector('input[type=password]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(PASSWORD)});
    i.dispatchEvent(new Event('input', { bubbles: true }));
    i.form.requestSubmit();
    return 1;
  })()`);
  await until(`!!document.querySelector('.app-header')`, 'app after the password gate');
  check('Password gate accepts the password and opens the app', true);

  // Opens the simulator from a button and returns what the dialog shows.
  const simulate = async (buttonExpr, label) => {
    await until(`!!(${buttonExpr})`, `${label}: Simulate button`);
    const name = await evaluate(`(() => { const b = ${buttonExpr}; const n = (b.getAttribute('aria-label') || '').split(': ')[1] || ''; b.click(); return n; })()`);
    await until(`!!document.querySelector('[role=dialog][aria-modal=true] #sim-title')`, `${label}: simulator dialog`);
    const shown = await evaluate(`(() => {
      const d = document.querySelector('[role=dialog][aria-modal=true]');
      const v = (d.querySelector('#sim-cost') || d.querySelector('#sim-comp-cost')).value;
      return { sub: d.querySelector('.side-sub').textContent, value: v, visible: d.getBoundingClientRect().height > 100 };
    })()`);
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })), 1`);
    await until(`!document.querySelector('[role=dialog][aria-modal=true]')`, `${label}: dialog closes`);
    return { name, ...shown };
  };

  // 2. Category-Item Summary: Roma tomatoes row (the SKU filter expands its subcategory).
  const ci = await simulate(`document.querySelector('button[aria-label="Simulate cost change: Roma Tomatoes"]')`, 'Category-Item Summary');
  check('Category-Item Summary opens the simulator for Roma Tomatoes, prefilled', ci.visible && ci.sub.includes('Roma Tomatoes') && /^\d+\.\d{2}$/.test(ci.value) && Number(ci.value) > 0, `prefill $${ci.value}`);

  // 3. Item Cost Over Time: the view's button (Roma tomatoes by default).
  await send('Page.navigate', { url: `${base}/?tab=itemcost` });
  await until(`[...document.querySelectorAll('button.btn-outline')].some((b) => b.textContent.includes('Simulate cost change'))`, 'Item Cost Over Time: button');
  const ic = await simulate(`[...document.querySelectorAll('button.btn-outline')].find((b) => b.textContent.includes('Simulate cost change'))`, 'Item Cost Over Time');
  check('Item Cost Over Time opens the simulator for Roma Tomatoes, prefilled', ic.visible && ic.sub.includes('Roma Tomatoes') && Number(ic.value) > 0, `prefill $${ic.value}`);

  check('No console errors or exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
  ws.close();
  return results.every((r) => r.ok);
}

main()
  .then(async (ok) => {
    await cleanup();
    process.exit(ok ? 0 : 1);
  })
  .catch(async (err) => {
    console.error(`✗ ${err.message}`);
    await cleanup();
    process.exit(1);
  });
