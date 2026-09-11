// Membership CTA (one paid plan since 11 Sept 2026: Sessions, $1,200 a year)
// and the cross-page anchor fix in common.js. The founding-rate promo bar and
// [data-founding-*] copy switch were removed with the Full plan.
// Tiny hand-rolled DOM stub in the style of back-to-top.test.js - no jsdom.
// Run: node --test 'tests/**/*.test.js'
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { renderPost, membershipCta } from '../api/_post-template.js';

const require = createRequire(import.meta.url);
const { initHashScroll } = require('../common.js');

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this._top = 0;
  }
  getBoundingClientRect() { return { top: this._top }; }
}
function install({ qs = {}, hash = '' } = {}) {
  global.document = {
    querySelector: (sel) => (sel in qs ? qs[sel] : null),
  };
  global.window = {
    pageYOffset: 0,
    location: { pathname: '/', hash },
    addEventListener: () => {},
    removeEventListener: () => {},
    scrollTo: (x, y) => { global.window._scrolledTo = y; global.window.pageYOffset = y; },
  };
}
afterEach(() => { delete global.document; delete global.window; });

/* ---- initHashScroll (cross-page anchor fix) ---- */

test('scrolls the #hash target under the fixed nav (76px offset)', () => {
  const target = new El('section'); target._top = 3600;
  install({ hash: '#chapter-terms', qs: { '#chapter-terms': target } });
  initHashScroll();
  assert.equal(global.window._scrolledTo, 3600 - 76);
});

test('no hash or missing target: no scroll', () => {
  install({ hash: '' });
  initHashScroll();
  assert.equal(global.window._scrolledTo, undefined);
  install({ hash: '#nope' });
  initHashScroll();
  assert.equal(global.window._scrolledTo, undefined);
});

/* ---- blog end-of-post CTA ---- */

const base = {
  slug: 'test-post',
  title: 'Test Post',
  body_html: '<p>Hello</p>',
  published_at: '2026-07-01T00:00:00Z',
  author: 'Raj Goodman Anand',
};

test('CTA pitches the single Sessions plan with no founding-rate language', () => {
  const html = membershipCta();
  assert.match(html, /class="pcta"/);
  assert.match(html, /12 live build sessions/);
  assert.match(html, /\$100 a month/);
  assert.doesNotMatch(html, /\$3,000|\$4,800|founding|15 Sept/i);
  assert.match(html, /utm_content=blog-post/);
});

test('renderPost places the CTA between the article and Work With Us', () => {
  const html = renderPost(base);
  const cta = html.indexOf('class="pcta"');
  assert.ok(cta !== -1, 'CTA present');
  assert.ok(html.indexOf('</article>') < cta, 'after the article');
  assert.ok(cta < html.indexOf('Work With Us'), 'before the Work With Us section');
});
