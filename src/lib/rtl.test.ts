// B15 (RTL): lint-style guard + DOM harness for logical-property compliance.
//
// 1. Fails on physical LTR directionals (physical margin/padding,
//    physical text alignment and anchors, horizontal spacing utilities,
//    horizontal dividers, physical border/rounded sides, physical
//    float/clear) anywhere in views / components / App / CSS, with an
//    explicit allowlist for justified exceptions.
// 2. Asserts the sidebar docking contract in Sidebar.tsx source
//    (logical start-0 anchor, max-lg:-scoped off-canvas transforms,
//    overlay + close control + Escape handling, stable selectors).
// 3. Renders the real <Sidebar/> to static markup in EN + AR (harness proof)
//    and asserts drawer classes, overlay behavior and dir correctness.
//    Rect-inside-viewport still needs a live browser (delivery-lead check).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCAN_DIRS = ['src/views', 'src/components'];
const SCAN_FILES = ['src/App.tsx', 'src/index.css'];

function collectTsx(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir))
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => path.join(ROOT, dir, f));
}

function scanTargets(): string[] {
  const files = SCAN_DIRS.flatMap(collectTsx);
  for (const f of SCAN_FILES) files.push(path.join(ROOT, f));
  return files;
}

// Token-boundary regexes: (?<![\w-]) avoids matching inside longer class
// names (rounded-lg, border-rose, placeholder, hover:...) while still
// catching responsive/directional-prefixed physicals (a small-screen margin
// utility must fail just like a bare one). Physical tokens are split below
// (e.g. 'divid' + 'e-x') so this file's own text never forms a scannable
// Tailwind candidate — otherwise the linter itself would pollute the CSS
// bundle with the very utilities it forbids.
const BANNED: Array<{ name: string; re: RegExp }> = [
  { name: 'physical margin', re: /(?<![\w-])(ml|mr)-\d/ },
  { name: 'physical padding', re: /(?<![\w-])(pl|pr)-\d/ },
  { name: 'physical text alignment', re: /(?<![\w-])text-(left|right)(?![\w-])/ },
  { name: 'physical anchor', re: /(?<![\w-])(left|right)-\d/ },
  { name: 'horizontal spacing (use gap-*)', re: new RegExp('space-' + 'x-') },
  { name: 'horizontal divide (use the vertical/logical alternative)', re: new RegExp('divid' + 'e-x(?![\\w-])|divid' + 'e-x-\\d') },
  { name: 'physical border side', re: /(?<![\w-])border-[lr](?![\w-])|(?<![\w-])border-[lr]-\d/ },
  { name: 'physical rounded side', re: /(?<![\w-])rounded-[lr](?![\w-])|(?<![\w-])rounded-[lr]-\d/ },
  { name: 'physical float', re: /(?<![\w-])float-(left|right)(?![\w-])/ },
  { name: 'physical clear', re: /(?<![\w-])clear-(left|right)(?![\w-])/ },
];

// Explicit allowlist for justified exceptions. Empty: every physical
// directional currently in scope was converted to a logical equivalent.
// To add one: { file: '<basename>', pattern: '<token>', reason: '<why>' }.
const ALLOWLIST: Array<{ file: string; pattern: string; reason: string }> = [];

function isAllowed(file: string, line: string): string | null {
  const base = path.basename(file);
  for (const a of ALLOWLIST) {
    if (a.file === base && line.includes(a.pattern)) return a.reason;
  }
  return null;
}

test('B15 RTL: no physical LTR directionals in views/components/App/css', () => {
  const violations: string[] = [];
  for (const file of scanTargets()) {
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      for (const b of BANNED) {
        if (b.re.test(line) && !isAllowed(file, line)) {
          violations.push(`${path.basename(file)}:${i + 1} [${b.name}] ${line.trim().slice(0, 140)}`);
        }
      }
    });
  }
  assert.equal(
    violations.length,
    0,
    `Physical LTR directionals found (fix with logical equivalents or allowlist with reason):\n${violations.join('\n')}`,
  );
});

// Drawer-transform tokens, split so this file's own text never forms a
// scannable Tailwind candidate (a literal visible/hide transform in a
// comment or assertion string would otherwise emit a dead unscoped utility
// into the CSS bundle — exactly what the sidebar contract forbids).
const TX_0 = 'translate-' + 'x-0';
const TX_FULL = '-translate-' + 'x-full';
const RTL_TX_FULL = 'rtl:translate-' + 'x-full';
const MAX = 'max-' + 'lg:';
const MAX_TX_0 = MAX + TX_0;
const MAX_TX_FULL = MAX + TX_FULL;
const MAX_RTL_TX_FULL = MAX + RTL_TX_FULL;

test('B15 RTL: sidebar docking contract (source)', () => {
  const src = readFileSync(path.join(ROOT, 'src/components/Sidebar.tsx'), 'utf8');
  // Logical anchor: fixed drawer must be pinned to the inline-start side
  // (right in RTL, left in LTR). The original bug had no horizontal anchor.
  assert.ok(src.includes('start-0'), 'aside must be anchored with logical start-0');
  // Desktop is always docked (static in flex flow; flex auto-mirrors).
  assert.ok(src.includes('lg:static'), 'aside must be lg:static on desktop');
  // Off-canvas transforms must be mobile-scoped so no variant-ordering
  // conflict can push the desktop sidebar off-screen in either direction.
  assert.ok(src.includes(MAX_TX_FULL), 'closed drawer must hide toward its anchor side on mobile');
  assert.ok(
    src.includes(MAX_RTL_TX_FULL),
    'closed drawer must hide toward the RTL side on mobile',
  );
  assert.ok(src.includes(MAX_TX_0), 'open drawer must show its visible transform on mobile');
  assert.equal(
    (src.match(new RegExp('(?<!' + MAX + ')' + TX_FULL, 'g')) ?? []).length,
    0,
    'no unscoped hide-transform may remain (desktop off-screen risk)',
  );
  assert.equal(
    (src.match(new RegExp('(?<!' + MAX + ')' + RTL_TX_FULL, 'g')) ?? []).length,
    0,
    'no unscoped RTL hide-transform may remain (desktop off-screen risk)',
  );
  assert.equal(
    (src.match(new RegExp('(?<!lg:)' + TX_0 + '(?![\\w-])', 'g')) ?? []).length,
    0,
    'no unscoped visible-transform may remain (the desktop rule carries the lg: prefix)',
  );
  // Mobile drawer UX: overlay click + close button + Escape.
  assert.ok(src.includes('data-testid="sidebar"'), 'aside needs stable selector data-testid="sidebar"');
  assert.ok(src.includes('data-testid="sidebar-overlay"'), 'overlay needs data-testid="sidebar-overlay"');
  assert.ok(src.includes('onClick={onClose}'), 'overlay click must dismiss the drawer');
  assert.ok(src.includes('data-testid="sidebar-close"'), 'drawer needs a close control');
  assert.ok(src.includes("'Escape'"), 'Escape must dismiss the drawer');
});

test('B15 RTL: header hamburger + main content selectors (source)', () => {
  const header = readFileSync(path.join(ROOT, 'src/components/Header.tsx'), 'utf8');
  assert.ok(header.includes('data-testid="open-mobile-menu"'), 'hamburger needs data-testid="open-mobile-menu"');
  assert.ok(header.includes('lg:hidden'), 'hamburger must be mobile-only');
  const app = readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf8');
  assert.ok(app.includes('data-testid="main-content"'), 'main needs data-testid="main-content" for rect checks');
});

test('B15 RTL: dir="ltr" isolates on codes / scores / emails (source)', () => {
  const mustContain = (file: string, token: string, min: number) => {
    const src = readFileSync(path.join(ROOT, file), 'utf8');
    const n = src.split(token).length - 1;
    assert.ok(n >= min, `${file} must contain >= ${min} ${token} isolates (found ${n})`);
  };
  mustContain('src/views/ImportGRIView.tsx', 'dir="ltr"', 4);
  mustContain('src/views/ReportsView.tsx', 'dir="ltr"', 8);
  mustContain('src/views/AuditLogView.tsx', 'dir="ltr"', 3);
  mustContain('src/views/StaffListsView.tsx', 'dir="ltr"', 2);
  mustContain('src/views/LoginView.tsx', 'dir="ltr"', 1);
  mustContain('src/views/SetupView.tsx', 'dir="ltr"', 1);
});

test('B15 RTL: directional arrow icons mirror in RTL (source)', () => {
  for (const file of collectTsx('src/views')) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/<Arrow(Right|Left)\b/.test(line) && !line.includes('from ')) {
        assert.ok(
          line.includes('rtl:rotate-180'),
          `${path.basename(file)}:${i + 1}: directional arrow must carry rtl:rotate-180`,
        );
      }
    });
  }
});

test('B15 RTL: print stylesheet is RTL-correct (source)', () => {
  const reports = readFileSync(path.join(ROOT, 'src/views/ReportsView.tsx'), 'utf8');
  assert.ok(reports.includes('hidden print:block'), 'print block must render for print');
  assert.ok(reports.includes('print:hidden'), 'screen chrome must hide for print');
  const css = readFileSync(path.join(ROOT, 'src/index.css'), 'utf8');
  assert.ok(css.includes('@media print'), 'index.css must contain a print block');
  assert.ok(css.includes("html[dir=\"rtl\"]"), 'print block must re-assert RTL direction');
});

// --- DOM harness: render the real <Sidebar/> in EN + AR -------------------
// Static markup only (no layout engine): asserts drawer classes, overlay
// behavior and dir-correct labels. Rect-inside-viewport is verified live
// by the delivery lead (see handback checklist).

type LocalStorageStub = { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void };

function stubStorage(lang: 'en' | 'ar'): void {
  const store: Record<string, string> = { greenedge_lang: lang };
  const stub: LocalStorageStub = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
  };
  (globalThis as unknown as { localStorage: LocalStorageStub }).localStorage = stub;
}

async function renderSidebar(lang: 'en' | 'ar', isOpen: boolean): Promise<string> {
  stubStorage(lang);
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { LanguageProvider } = await import('../i18n/LanguageContext.tsx');
  const { AuthProvider } = await import('../context/AuthContext.tsx');
  const { Sidebar } = await import('../components/Sidebar.tsx');
  return renderToStaticMarkup(
    React.createElement(
      LanguageProvider,
      null,
      React.createElement(
        AuthProvider,
        null,
        React.createElement(Sidebar, { activeTab: 'dashboard', setActiveTab: () => {}, isOpen, onClose: () => {} }),
      ),
    ),
  );
}

test('B15 RTL harness: closed drawer renders docked-safe markup (EN + AR)', async () => {
  for (const lang of ['en', 'ar'] as const) {
    const html = await renderSidebar(lang, false);
    assert.ok(html.includes('data-testid="sidebar"'), `[${lang}] aside must be rendered`);
    assert.ok(html.includes('start-0'), `[${lang}] aside must carry the logical start-0 anchor`);
    assert.ok(html.includes('lg:static'), `[${lang}] aside must carry lg:static for desktop docking`);
    assert.ok(html.includes(MAX_TX_FULL), `[${lang}] closed drawer must hide toward its anchor side`);
    assert.ok(!html.includes('data-testid="sidebar-overlay"'), `[${lang}] closed drawer must render no overlay`);
    if (lang === 'ar') {
      assert.ok(html.includes('إغلاق القائمة'), '[ar] close control must be Arabic-labelled');
    } else {
      assert.ok(html.includes('Close navigation menu'), '[en] close control must be English-labelled');
    }
  }
});

test('B15 RTL harness: open drawer renders overlay + visible transform (EN + AR)', async () => {
  for (const lang of ['en', 'ar'] as const) {
    const html = await renderSidebar(lang, true);
    assert.ok(html.includes(MAX_TX_0), `[${lang}] open drawer must carry its visible transform`);
    assert.ok(html.includes('data-testid="sidebar-overlay"'), `[${lang}] open drawer must render the overlay`);
    assert.ok(html.includes('data-testid="sidebar-close"'), `[${lang}] open drawer must render the close control`);
  }
});
