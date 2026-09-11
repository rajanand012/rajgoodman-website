/* Shared interactions: scroll reveal, animated counters, smooth-scroll, mobile nav */
(function () {
  'use strict';

  /* ---- Scroll reveal (rect-based so it never depends on iframe visibility) ---- */
  function initReveal() {
    var els = [].slice.call(document.querySelectorAll('[data-reveal]'));
    if (els.length === 0) return;
    function show(el) {
      if (el.classList.contains('is-in')) return;
      var delay = el.getAttribute('data-delay');
      if (delay) el.style.transitionDelay = delay + 'ms';
      el.classList.add('is-in');
    }
    function check() {
      var vh = window.innerHeight || document.documentElement.clientHeight;
      for (var i = els.length - 1; i >= 0; i--) {
        var el = els[i];
        var r = el.getBoundingClientRect();
        if (r.top < vh * 0.92 && r.bottom > 0) {
          show(el);
          els.splice(i, 1);
        }
      }
      if (els.length === 0) {
        window.removeEventListener('scroll', check);
        window.removeEventListener('resize', check);
      }
    }
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    check();
    requestAnimationFrame(check);
    window.addEventListener('load', check);
    /* absolute failsafe: never leave content hidden */
    setTimeout(function () { els.slice().forEach(show); }, 2600);
  }

  /* ---- Animated counters ---- */
  function animateCount(el) {
    var target = parseFloat(el.getAttribute('data-count'));
    var decimals = (el.getAttribute('data-count').split('.')[1] || '').length;
    var suffix = el.getAttribute('data-suffix') || '';
    var dur = 1600;
    var start = null;
    function ease(t) { return 1 - Math.pow(1 - t, 3); }
    function step(ts) {
      if (!start) start = ts;
      var p = Math.min((ts - start) / dur, 1);
      var val = ease(p) * target;
      el.textContent = (decimals ? val.toFixed(decimals) : Math.round(val).toLocaleString()) + suffix;
      if (p < 1) requestAnimationFrame(step);
      else el.textContent = (decimals ? target.toFixed(decimals) : target.toLocaleString()) + suffix;
    }
    requestAnimationFrame(step);
  }
  function initCounters() {
    var els = [].slice.call(document.querySelectorAll('[data-count]'));
    if (els.length === 0) return;
    function check() {
      var vh = window.innerHeight || document.documentElement.clientHeight;
      for (var i = els.length - 1; i >= 0; i--) {
        var el = els[i], r = el.getBoundingClientRect();
        if (r.top < vh * 0.9 && r.bottom > 0) { animateCount(el); els.splice(i, 1); }
      }
      if (els.length === 0) window.removeEventListener('scroll', check);
    }
    window.addEventListener('scroll', check, { passive: true });
    check();
    requestAnimationFrame(check);
    setTimeout(check, 400);
  }

  /* ---- Smooth anchor scroll ---- */
  function initSmoothScroll() {
    document.addEventListener('click', function (e) {
      var a = e.target.closest('a[href^="#"]');
      if (!a) return;
      var id = a.getAttribute('href');
      if (id === '#' || id.length < 2) return;
      var t = document.querySelector(id);
      if (!t) return;
      e.preventDefault();
      var top = t.getBoundingClientRect().top + window.pageYOffset - 76;
      window.scrollTo({ top: top, behavior: 'smooth' });
      var nav = document.querySelector('[data-mobile-nav]');
      if (nav) nav.classList.remove('open');
    });
  }

  /* ---- Sticky nav shadow + mobile toggle ---- */
  function initNav() {
    var nav = document.querySelector('[data-nav]');
    if (nav) {
      var onScroll = function () { nav.classList.toggle('scrolled', window.pageYOffset > 24); };
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }
    var toggle = document.querySelector('[data-nav-toggle]');
    var menu = document.querySelector('[data-mobile-nav]');
    if (toggle && menu) {
      toggle.addEventListener('click', function () { menu.classList.toggle('open'); });
    }
  }

  /* ---- Hero pointer parallax (subtle) ---- */
  function initParallax() {
    var scene = document.querySelector('[data-parallax-scene]');
    if (!scene || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    scene.addEventListener('pointermove', function (e) {
      var r = scene.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width - 0.5;
      var y = (e.clientY - r.top) / r.height - 0.5;
      scene.querySelectorAll('[data-depth]').forEach(function (el) {
        var d = parseFloat(el.getAttribute('data-depth'));
        el.style.transform = 'translate3d(' + (x * d * 28) + 'px,' + (y * d * 28) + 'px,0)';
      });
    });
    scene.addEventListener('pointerleave', function () {
      scene.querySelectorAll('[data-depth]').forEach(function (el) { el.style.transform = ''; });
    });
  }

  /* ---- In-page YouTube lightbox (fast + SEO-safe) ----
     Real <a href="…youtube…"> links stay in the DOM for crawlers and as a
     no-JS fallback. No iframe is created until the user clicks, so the page
     stays fast and YouTube doesn't load on first paint. */
  function initVideoLightbox() {
    var YT = /(?:youtube(?:-nocookie)?\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/;
    var style = document.createElement('style');
    style.textContent =
      '.vlb{position:fixed;inset:0;z-index:200;display:none;align-items:center;justify-content:center;padding:24px}' +
      '.vlb.open{display:flex}' +
      '.vlb-bd{position:absolute;inset:0;background:rgba(10,7,1,.86);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}' +
      '.vlb-box{position:relative;width:min(1040px,100%);z-index:1}' +
      '.vlb-frame{position:relative;aspect-ratio:16/9;background:#000;border:1px solid rgba(244,239,230,.18);box-shadow:0 30px 90px -20px rgba(0,0,0,.85)}' +
      '.vlb-frame iframe{position:absolute;inset:0;width:100%;height:100%;border:0}' +
      '.vlb-x{position:absolute;top:-46px;right:0;background:none;border:0;color:#f4efe6;font-size:34px;line-height:1;cursor:pointer;padding:4px 8px;font-family:inherit}' +
      '.vlb-x:hover{color:#f3af00}';
    document.head.appendChild(style);
    var modal = document.createElement('div');
    modal.className = 'vlb';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = '<div class="vlb-bd"></div><div class="vlb-box"><button class="vlb-x" aria-label="Close video">×</button><div class="vlb-frame"></div></div>';
    document.body.appendChild(modal);
    var frame = modal.querySelector('.vlb-frame');
    function toSeconds(s) {
      if (!s) return 0;
      if (/^\d+$/.test(s)) return parseInt(s, 10);
      var h = (s.match(/(\d+)h/) || [])[1] || 0, m = (s.match(/(\d+)m/) || [])[1] || 0, x = (s.match(/(\d+)s/) || [])[1] || 0;
      return (+h) * 3600 + (+m) * 60 + (+x);
    }
    function open(id, start) {
      var src = 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&rel=0' + (start ? '&start=' + start : '');
      frame.innerHTML = '<iframe src="' + src +
        '" title="Video" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>';
      modal.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
    function close() {
      modal.classList.remove('open');
      frame.innerHTML = '';
      document.body.style.overflow = '';
    }
    document.addEventListener('click', function (e) {
      var a = e.target.closest('a[href]');
      if (!a) return;
      var href = a.getAttribute('href');
      var m = href.match(YT);
      if (!m) return; // not a single video (e.g. channel/article links) - let it through
      e.preventDefault();
      var tm = href.match(/[?&](?:t|start)=([0-9hms]+)/);
      open(m[1], tm ? toSeconds(tm[1]) : 0);
    });
    modal.querySelector('.vlb-bd').addEventListener('click', close);
    modal.querySelector('.vlb-x').addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  }

  /* ---- Forms: Cloudflare Turnstile + serverless submit ----
     Each form is marked with data-form="contact" | "newsletter". The widget is
     rendered explicitly so we control placement, and submit is intercepted to
     POST JSON (named fields + Turnstile token) to the matching /api endpoint. */
  var TURNSTILE_SITEKEY = '0x4AAAAAADpKQw5ozbUsMz-E'; // public sitekey - safe to commit
  var FORM_ENDPOINTS = { contact: '/api/contact/', newsletter: '/api/subscribe/' }; // trailing slash: trailingSlash:true 308-redirects the non-slash form

  /* GA4 conversion events via the GTM dataLayer. Event names must match the
     live GTM container (GTM-PQ6PSBZN) exactly - they are the reporting
     continuity contract across the WordPress cutover. Inert until the GTM
     snippet is added to the site. Deliberately NOT pushed for tel:/mailto:
     clicks - GTM's own link-click triggers already fire phone_click /
     email_click, so a push here would double-count. */
  function trackEvent(name) {
    (window.dataLayer = window.dataLayer || []).push({ event: name });
  }

  function initForms() {
    var forms = [].slice.call(document.querySelectorAll('form[data-form]'));
    if (forms.length === 0) return;

    // Load the Turnstile script once, then render every widget explicitly.
    window.onTurnstileLoad = function () {
      forms.forEach(function (form) {
        var mount = form.querySelector('[data-turnstile]');
        if (!mount) return;
        form._tsWidgetId = window.turnstile.render(mount, {
          sitekey: TURNSTILE_SITEKEY,
          theme: 'dark',
        });
      });
    };
    var s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileLoad';
    s.async = true;
    s.defer = true;
    // If the script never loads (ad blocker, network), the widget can't render
    // and no token can ever exist - say so instead of leaving a dead form.
    s.onerror = function () {
      forms.forEach(function (form) {
        form._tsBlocked = true;
        var mount = form.querySelector('[data-turnstile]');
        if (mount) {
          mount.innerHTML = '<p style="font-size:.84rem;color:var(--tx-60,#999);border:1px solid var(--line,#444);border-radius:4px;padding:.7em .9em;margin:0">'
            + 'The verification step couldn’t load - it may be blocked by a browser extension. '
            + 'Please allow challenges.cloudflare.com, or email '
            + '<a href="mailto:raj@goodmanlantern.com" style="color:var(--yellow,#f3af00)">raj@goodmanlantern.com</a> directly.</p>';
        }
      });
    };
    document.head.appendChild(s);

    forms.forEach(function (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var type = form.getAttribute('data-form');
        var endpoint = FORM_ENDPOINTS[type];
        if (!endpoint) return;

        var btn = form.querySelector('.btn');
        if (form._tsBlocked) {
          setBtn(btn, 'Verification blocked - please email us', false);
          return;
        }
        var token = window.turnstile && form._tsWidgetId != null
          ? window.turnstile.getResponse(form._tsWidgetId) : '';
        if (!token) {
          setBtn(btn, 'Please complete the verification', false);
          return;
        }

        // Serialize named fields.
        var payload = { token: token };
        [].slice.call(form.querySelectorAll('[name]')).forEach(function (f) {
          payload[f.name] = f.value;
        });
        payload.source_page = location.host + location.pathname;

        setBtn(btn, 'Sending…', true);
        fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
          .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok && j.ok, pending: !!j.pending }; }); })
          .then(function (result) {
            if (result.ok) {
              trackEvent(type === 'newsletter' ? 'email_subscribe' : 'contact_form');
              var doneMsg = type === 'newsletter'
                ? (result.pending ? 'Almost done - check your inbox to confirm' : 'Thanks - you\'re subscribed')
                : 'Thank you - we\'ll be in touch';
              setBtn(btn, doneMsg, true);
              [].slice.call(form.querySelectorAll('input,select,textarea,button')).forEach(function (el) { el.disabled = true; });
            } else {
              setBtn(btn, 'Something went wrong - try again', false);
              if (window.turnstile && form._tsWidgetId != null) window.turnstile.reset(form._tsWidgetId);
            }
          })
          .catch(function () {
            setBtn(btn, 'Network error - try again', false);
            if (window.turnstile && form._tsWidgetId != null) window.turnstile.reset(form._tsWidgetId);
          });
      });
    });

    // Update button label while preserving its arrow icon; disabled controls re-submit.
    function setBtn(btn, text, disabled) {
      if (!btn) return;
      var ar = btn.querySelector('.ar');
      btn.textContent = text;
      if (ar) { btn.appendChild(document.createTextNode(' ')); btn.appendChild(ar); }
      btn.disabled = !!disabled;
    }
  }

  /* ---- LinkedIn widget: replace the static fallback cards with managed posts.
     Progressive enhancement - if the API is empty or unreachable, the hard-coded
     cards in the page stay. Injected cards omit data-reveal so they're visible
     immediately (the reveal observer has already run by the time this resolves). */
  function initLinkedIn() {
    var grid = document.querySelector('[data-li-grid]');
    if (!grid) return;
    fetch('/api/linkedin/').then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || !d.posts || !d.posts.length) return; // keep the static fallback cards
      var posts = d.posts.slice(0, 4);
      var cards = [].slice.call(grid.querySelectorAll('.li-card'));
      // Update existing cards in place so their layout + reveal state are untouched;
      // only append/remove if the managed count differs from the hard-coded one.
      posts.forEach(function (p, i) {
        var a = cards[i];
        if (!a) {
          a = document.createElement('a');
          a.className = 'li-card'; a.target = '_blank'; a.rel = 'noopener';
          a.innerHTML = '<img loading="lazy"/><span class="tag">in &middot; Raj Anand</span>';
          grid.appendChild(a); a.classList.add('is-in');
        }
        a.href = p.url || '#';
        var img = a.querySelector('img');
        if (img) { img.src = p.image_url || ''; img.alt = p.title || 'Raj Goodman LinkedIn post'; }
      });
      for (var j = posts.length; j < cards.length; j++) { cards[j].parentNode.removeChild(cards[j]); }
    }).catch(function () { /* keep the static fallback */ });
  }

  /* ---- Gated downloads: [data-download="<asset>"] opens a modal form.
     Human verification + lead capture happen in /api/download/, which alone
     knows the file URLs - nothing downloadable is exposed in the markup. */
  function initDownloads() {
    var triggers = [].slice.call(document.querySelectorAll('[data-download]'));
    if (triggers.length === 0) return;

    var overlay = null, tsWidget = null, currentAsset = '';

    /* The registry key doubles as the asset kind: audiobook-* keys label the
       modal "Audiobook", everything else stays "eBook". */
    function assetKind() { return currentAsset.indexOf('audiobook-') === 0 ? 'Audiobook' : 'eBook'; }

    function buildModal() {
      var css = document.createElement('style');
      css.textContent =
        '.dlm-overlay{position:fixed;inset:0;z-index:220;background:rgba(20,14,4,.65);backdrop-filter:blur(3px);display:grid;place-items:center;padding:20px}' +
        '.dlm{width:min(440px,100%);background:var(--bg-2,#2a1d08);border:1px solid var(--line,rgba(244,239,230,.12));border-radius:10px;padding:26px;color:var(--tx,#f4efe6);font-family:var(--ff,system-ui,sans-serif);box-shadow:0 24px 70px -16px rgba(0,0,0,.7);position:relative}' +
        '.dlm h3{font-size:1.15rem;font-weight:800;margin:0 2em .35rem 0}' +
        '.dlm .dlm-asset{font-size:.86rem;color:var(--tx-60,rgba(244,239,230,.62));margin:0 0 16px}' +
        '.dlm label{display:block;font-size:.82rem;font-weight:600;margin:12px 0 6px}' +
        '.dlm input{width:100%;font-family:inherit;font-size:.96rem;padding:.82em 1em;border:1px solid var(--line,rgba(244,239,230,.12));border-radius:4px;background:var(--bg,#201600);color:var(--tx,#f4efe6)}' +
        '.dlm input:focus{outline:0;border-color:var(--blue-l,#48a7cb)}' +
        '.dlm .dlm-close{position:absolute;top:14px;right:14px;background:none;border:0;color:var(--tx-60,rgba(244,239,230,.62));font-size:1.3rem;line-height:1;cursor:pointer;padding:4px}' +
        '.dlm .dlm-close:hover{color:var(--tx,#f4efe6)}' +
        '.dlm .btn{width:100%;justify-content:center;margin-top:16px}' +
        '.dlm .dlm-note{font-size:.8rem;color:var(--tx-60,rgba(244,239,230,.62));margin-top:12px}' +
        '.dlm .dlm-success a.btn{text-decoration:none}';
      document.head.appendChild(css);

      overlay = document.createElement('div');
      overlay.className = 'dlm-overlay';
      overlay.innerHTML =
        '<div class="dlm" role="dialog" aria-modal="true" aria-labelledby="dlm-title">' +
          '<button type="button" class="dlm-close" aria-label="Close">&times;</button>' +
          '<form class="dlm-form">' +
            '<h3 id="dlm-title">Get the eBook</h3>' +
            '<p class="dlm-asset"></p>' +
            '<label for="dlm-name">Name *</label><input id="dlm-name" name="name" autocomplete="name" required placeholder="Your name" />' +
            '<label for="dlm-email">Email Address *</label><input id="dlm-email" name="email" type="email" autocomplete="email" required placeholder="you@company.com" />' +
            '<div data-turnstile style="margin:14px 0 0"></div>' +
            '<button class="btn btn-y" type="submit">Get the eBook <span class="ar">&rarr;</span></button>' +
          '</form>' +
          '<div class="dlm-success" style="display:none"></div>' +
        '</div>';
      document.body.appendChild(overlay);

      overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
      overlay.querySelector('.dlm-close').addEventListener('click', close);
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && overlay.style.display !== 'none') close(); });

      overlay.querySelector('.dlm-form').addEventListener('submit', function (e) {
        e.preventDefault();
        var form = e.target;
        var btn = form.querySelector('.btn');
        if (!window.turnstile || tsWidget == null) { setLabel(btn, 'Verification blocked - please email us'); return; }
        var token = window.turnstile.getResponse(tsWidget);
        if (!token) { setLabel(btn, 'Please complete the verification'); return; }

        setLabel(btn, 'Preparing your download…'); btn.disabled = true;
        fetch('/api/download/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            token: token,
            name: form.querySelector('#dlm-name').value.trim(),
            email: form.querySelector('#dlm-email').value.trim(),
            asset: currentAsset,
            source_page: location.host + location.pathname,
          }),
        })
          .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok && j.ok, j: j }; }); })
          .then(function (res) {
            if (res.ok) { showSuccess(res.j); }
            else { setLabel(btn, 'Something went wrong - try again'); btn.disabled = false; window.turnstile.reset(tsWidget); }
          })
          .catch(function () { setLabel(btn, 'Network error - try again'); btn.disabled = false; window.turnstile.reset(tsWidget); });
      });
    }

    function setLabel(btn, text) {
      var ar = btn.querySelector('.ar');
      btn.textContent = text;
      if (ar) { btn.appendChild(document.createTextNode(' ')); btn.appendChild(ar); }
    }

    function showSuccess(j) {
      trackEvent(assetKind() === 'Audiobook' ? 'audio_books_form' : 'ebooks_the_ai_first_mindset_form');
      var box = overlay.querySelector('.dlm-success');
      overlay.querySelector('.dlm-form').style.display = 'none';
      box.innerHTML =
        '<h3>Your download is ready</h3>' +
        '<p class="dlm-asset">' + (j.title || 'Your ' + assetKind()) + '</p>' +
        '<a class="btn btn-y" href="' + j.url + '" target="_blank" rel="noopener">Download ' + assetKind() + ' <span class="ar">&rarr;</span></a>' +
        (j.pending ? '<p class="dlm-note">We’ve also sent you a confirmation email - confirm to get Raj’s newsletter.</p>' : '');
      box.style.display = 'block';
      // Open immediately as well - the button remains as a fallback.
      window.open(j.url, '_blank', 'noopener');
    }

    function open(asset, title) {
      currentAsset = asset;
      if (!overlay) buildModal();
      overlay.querySelector('#dlm-title').textContent = 'Get the ' + assetKind();
      overlay.querySelector('.dlm-asset').textContent = title;
      overlay.querySelector('.dlm-form').style.display = '';
      overlay.querySelector('.dlm-success').style.display = 'none';
      var btn = overlay.querySelector('.dlm-form .btn');
      setLabel(btn, 'Get the ' + assetKind()); btn.disabled = false;
      overlay.style.display = 'grid';
      if (window.turnstile) {
        if (tsWidget == null) tsWidget = window.turnstile.render(overlay.querySelector('[data-turnstile]'), { sitekey: TURNSTILE_SITEKEY, theme: 'dark' });
        else window.turnstile.reset(tsWidget);
      }
      overlay.querySelector('#dlm-name').focus();
    }
    function close() { if (overlay) overlay.style.display = 'none'; }

    triggers.forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        var card = el.closest ? el.closest('.book') : null;
        var title = card && card.querySelector('h3') ? card.querySelector('h3').textContent : '';
        open(el.getAttribute('data-download'), title);
      });
    });
  }

  /* ---- FAQ accordion: auto-collapse siblings so only one answer is open at a
     time (matches the live site). Scoped per .faq group, so independent FAQ
     blocks on a page don't affect each other. Uses native <details> toggle. */
  function initFaq() {
    var groups = [].slice.call(document.querySelectorAll('.faq'));
    groups.forEach(function (group) {
      var items = [].slice.call(group.querySelectorAll('details'));
      items.forEach(function (d) {
        d.addEventListener('toggle', function () {
          if (!d.open) return;
          items.forEach(function (other) { if (other !== d) other.open = false; });
        });
      });
    });
  }

  /* ---- Back-to-top button: injected once, site-wide (no per-page markup).
     Appears after scrolling down, smooth-scrolls to the top. Respects the
     reduced-motion preference. */
  function initBackToTop() {
    var btn = document.createElement('button');
    btn.className = 'to-top';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Back to top');
    btn.innerHTML = '<span aria-hidden="true">↑</span>';
    document.body.appendChild(btn);
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function onScroll() { btn.classList.toggle('show', window.pageYOffset > 600); }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    btn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    });
  }

  /* The founding-rate promo bar and [data-founding-*] copy switch were
     removed on 11 Sept 2026 when the Full plan was withdrawn. */
  var PROMO_GAP = 16; // kept: initHashScroll still allows for a top bar if one is ever injected

  /* ---- Cross-page anchor fix. The browser's native fragment jump does not
     fire on this site (pre-existing: /#work from blog pages landed at the
     top too), and even when it does the target sits under the fixed nav.
     Position #hash targets ourselves: instantly at DOMContentLoaded, and
     again at load (fonts/images shift layout) unless the user has already
     scrolled away. Mirrors the -76px nav offset used by initSmoothScroll,
     plus the promo bar height when shown. */
  function initHashScroll() {
    var hash = window.location.hash;
    if (!hash || hash.length < 2) return;
    var t;
    try { t = document.querySelector(hash); } catch (_) { return; }
    if (!t) return;
    var lastPlaced = -1;
    function place() {
      var bar = document.querySelector('.pbar');
      var off = 76 + (bar ? bar.offsetHeight + PROMO_GAP : 0);
      var y = Math.max(0, t.getBoundingClientRect().top + window.pageYOffset - off);
      window.scrollTo(0, y);
      lastPlaced = y;
    }
    place();
    window.addEventListener('load', function () {
      requestAnimationFrame(function () {
        if (Math.abs(window.pageYOffset - lastPlaced) < 4) place();
      });
    });
  }

  /* ---- Books slider ----
     The books sit on one row that scrolls horizontally instead of wrapping.
     The scrolling and snapping are pure CSS, so touch swipe works with no JS
     and the row still works if this script never runs; all this adds is the
     desktop arrows and their disabled states. Scrolls by whole cards. */
  function initBookSlider() {
    var root = document.querySelector('[data-book-slider]');
    if (!root) return;
    var track = root.querySelector('[data-book-track]');
    var prev = root.querySelector('[data-bs-prev]');
    var next = root.querySelector('[data-bs-next]');
    if (!track || !prev || !next) return;
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function step() {
      var card = track.querySelector('.book');
      if (!card) return track.clientWidth;
      var gap = parseFloat(getComputedStyle(track).columnGap || getComputedStyle(track).gap) || 14;
      return card.getBoundingClientRect().width + gap;
    }
    function update() {
      // 1px of slack: sub-pixel widths mean scrollLeft rarely lands exactly on max
      var max = track.scrollWidth - track.clientWidth;
      prev.disabled = track.scrollLeft <= 1;
      next.disabled = track.scrollLeft >= max - 1;
      // nothing to scroll (everything already fits) - hide the controls entirely
      root.classList.toggle('is-static', max <= 1);
    }
    function go(dir) {
      track.scrollBy({ left: dir * step(), behavior: reduce ? 'auto' : 'smooth' });
    }
    prev.addEventListener('click', function () { go(-1); });
    next.addEventListener('click', function () { go(1); });
    track.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
  }

  function init() {
    initReveal();
    initCounters();
    initSmoothScroll();
    initNav();
    initParallax();
    initVideoLightbox();
    initForms();
    initLinkedIn();
    initDownloads();
    initFaq();
    initBackToTop();
    initBookSlider();
    initHashScroll();
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
  /* Exposed for unit tests under Node (CommonJS); a no-op in the browser,
     where `module` is undefined. */
  if (typeof module !== 'undefined' && module.exports) module.exports = { initLinkedIn: initLinkedIn, initDownloads: initDownloads, initForms: initForms, initFaq: initFaq, initBackToTop: initBackToTop, initHashScroll: initHashScroll };
})();
