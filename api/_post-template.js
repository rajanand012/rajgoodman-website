// Renders a post record into a complete, SEO-faithful HTML page that matches
// the site theme (chrome injected by chrome.js, styling via site.css).

const SITE = 'https://rajgoodman.com';
const SITE_NAME = 'Raj Goodman';
const TWITTER = '@RajAnand';
const DEFAULT_OG_IMAGE = 'https://djpxdnxnvuokdfxlwktx.supabase.co/storage/v1/object/public/blog-media/wp-content/uploads/2025/06/Rectangle-2-1.webp';
const PERSON_ID = `${SITE}/#raj`;        // matches the site-wide Person node (see index.html)
const WEBSITE_ID = `${SITE}/#website`;
const SAME_AS = ['https://www.linkedin.com/in/rajanand/', 'https://x.com/RajAnand'];
// Author bio (E-E-A-T): single-author blog, so a static block rendered on Raj's posts.
const AUTHOR_PHOTO = 'https://djpxdnxnvuokdfxlwktx.supabase.co/storage/v1/object/public/blog-media/wp-content/uploads/2024/06/raj-1.webp';
const AUTHOR_BIO_TEXT = 'Raj Goodman Anand is an AI futurist, keynote speaker and founder of AI-First Mindset®. He built ventures including Goodman Lantern and GoPinLeads, and now helps leadership teams across five continents integrate AI into their daily operations.';

function catSlug(name) {
  return String(name == null ? '' : name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}
function stripTags(s) {
  return String(s == null ? '' : s).replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&#0?39;|&rsquo;|&#8217;/g, "'").replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
}
// Extract FAQ Q&A from <details><summary>Q</summary>…answer…</details> blocks for FAQPage schema.
function extractFaqs(html) {
  const out = [];
  const re = /<details\b[^>]*>([\s\S]*?)<\/details>/gi;
  let m;
  while ((m = re.exec(html || ''))) {
    const sm = m[1].match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i);
    if (!sm) continue;
    const q = stripTags(sm[1]);
    const a = stripTags(m[1].replace(/<summary\b[\s\S]*?<\/summary>/i, ''));
    if (q && a) out.push({ q, a });
  }
  return out;
}

function authorBio(post) {
  if (!/\braj\s+goodman\b/i.test(post.author || '')) return '';
  return `
    <aside class="author-bio" style="display:flex;gap:20px;align-items:flex-start;border:1px solid var(--line);border-radius:10px;padding:24px;margin-top:48px">
      <img src="${AUTHOR_PHOTO}" alt="${esc(post.author)}" loading="lazy" style="width:76px;height:76px;border-radius:50%;object-fit:cover;object-position:50% 20%;flex-shrink:0" />
      <div>
        <div style="font-weight:700">${esc(post.author)}</div>
        <div style="font-size:.78rem;text-transform:uppercase;letter-spacing:.08em;opacity:.6;margin:2px 0 10px">AI Futurist, Keynote Speaker &amp; Founder</div>
        <p style="margin:0 0 12px;opacity:.85">${esc(AUTHOR_BIO_TEXT)}</p>
        <div style="display:flex;gap:16px"><a href="/about/">More about Raj &rarr;</a><a href="https://www.linkedin.com/in/rajanand/" target="_blank" rel="noopener">LinkedIn</a></div>
      </div>
    </aside>`;
}

function recentCard(p) {
  const img = p.featured_image
    ? `<div class="th"><img src="${esc(p.featured_image)}" alt="${esc(p.featured_image_alt || p.title)}" loading="lazy"/></div>`
    : '';
  const ex = p.excerpt ? `<p>${esc(p.excerpt)}</p>` : '';
  return `<a class="post" href="/blog/${esc(p.slug)}/">${img}<div class="bd"><h3>${esc(p.title)}</h3>${ex}<span class="go">READ &#8594;</span></div></a>`;
}

// End-of-post membership promo. One paid plan since 11 Sept 2026 (Sessions,
// $1,200 a year); the founding-rate Full plan was withdrawn.
const MEMBERSHIP_URL = 'https://resources.aifirstmindset.ai/membership'
  + '?utm_source=rajgoodman.com&utm_medium=referral&utm_campaign=membership-2026&utm_content=blog-post';

export function membershipCta() {
  const detail = 'Join Raj&rsquo;s year-long AI-First Mindset&reg; Membership: 12 live build sessions, three deployed AI systems, $100 a month';
  return `<section class="wrap" style="max-width:760px;padding-bottom:30px">
    <div class="pcta">
      <div>
        <div class="pcta-t">Go from reading about AI to shipping it</div>
        <div class="pcta-d">${detail}</div>
      </div>
      <a class="btn btn-y" href="${MEMBERSHIP_URL}" target="_blank" rel="noopener">See the membership <span class="ar">&rarr;</span></a>
    </div>
  </section>`;
}

export function renderPost(post, recent = []) {
  const url = post.canonical_url || `${SITE}/blog/${post.slug}/`;
  const title = post.seo_title || post.title;
  const desc = post.meta_description || post.excerpt || '';
  const ogImage = post.featured_image || DEFAULT_OG_IMAGE;
  const published = post.published_at;
  const modified = post.modified_at || post.published_at;

  // Social (OG/Twitter) values: per-post override, else fall back to SEO fields.
  const ogTitle = post.og_title || title;
  const ogDesc = post.og_description || desc;
  const ogImg = post.og_image || ogImage;

  // Yoast-equivalent JSON-LD @graph: linked Article + WebPage + Person + WebSite
  // + ImageObject + BreadcrumbList, using the site-wide @ids.
  const imageId = `${url}#primaryimage`;
  const webpageId = `${url}#webpage`;
  const articleId = `${url}#article`;
  const breadcrumbId = `${url}#breadcrumb`;
  const jsonld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Person', '@id': PERSON_ID, name: post.author, alternateName: 'Raj Goodman',
        url: `${SITE}/`, image: DEFAULT_OG_IMAGE, jobTitle: 'AI Futurist, Keynote Speaker & Founder',
        description: AUTHOR_BIO_TEXT, sameAs: SAME_AS,
      },
      {
        '@type': 'WebSite', '@id': WEBSITE_ID, url: `${SITE}/`, name: SITE_NAME,
        publisher: { '@id': PERSON_ID }, inLanguage: 'en-US',
      },
      {
        '@type': 'ImageObject', '@id': imageId, url: ogImg, contentUrl: ogImg, inLanguage: 'en-US',
      },
      {
        '@type': 'WebPage', '@id': webpageId, url, name: title, isPartOf: { '@id': WEBSITE_ID },
        primaryImageOfPage: { '@id': imageId }, image: { '@id': imageId },
        datePublished: published, dateModified: modified, description: desc,
        breadcrumb: { '@id': breadcrumbId }, inLanguage: 'en-US',
      },
      {
        '@type': 'BreadcrumbList', '@id': breadcrumbId, itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE}/blog/` },
          { '@type': 'ListItem', position: 3, name: post.title },
        ],
      },
      {
        '@type': 'Article', '@id': articleId, isPartOf: { '@id': webpageId },
        author: { '@id': PERSON_ID }, publisher: { '@id': PERSON_ID },
        articleSection: (post.categories && post.categories.length) ? post.categories : undefined,
        headline: post.title, description: desc, datePublished: published, dateModified: modified,
        mainEntityOfPage: { '@id': webpageId }, image: { '@id': imageId }, inLanguage: 'en-US',
      },
    ],
  };

  // FAQPage schema from any <details> FAQ items in the body.
  const faqs = extractFaqs(post.body_html);
  if (faqs.length) {
    jsonld['@graph'].push({
      '@type': 'FAQPage', '@id': `${url}#faq`,
      mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
    });
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<script src="/assets/cookie-consent.js"></script>
<link rel="icon" href="/assets/favicon-32.png" sizes="32x32" />
<link rel="icon" href="/assets/favicon-192.png" sizes="192x192" />
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}" />
<meta name="robots" content="${esc(post.robots || 'index, follow')}" />
<meta name="author" content="${esc(post.author)}" />
<link rel="canonical" href="${esc(url)}" />
<meta property="og:locale" content="en_US" />
<meta property="og:type" content="article" />
<meta property="og:title" content="${esc(ogTitle)}" />
<meta property="og:description" content="${esc(ogDesc)}" />
<meta property="og:url" content="${esc(url)}" />
<meta property="og:site_name" content="${esc(SITE_NAME)}" />
${published ? `<meta property="article:published_time" content="${esc(published)}" />` : ''}
${modified ? `<meta property="article:modified_time" content="${esc(modified)}" />` : ''}
<meta property="og:image" content="${esc(ogImg)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:site" content="${TWITTER}" />
<meta name="twitter:creator" content="${TWITTER}" />
<meta name="twitter:title" content="${esc(ogTitle)}" />
<meta name="twitter:description" content="${esc(ogDesc)}" />
<meta name="twitter:image" content="${esc(ogImg)}" />
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
<!-- TODO(site-wide): inject GTM-PQ6PSBZN here once analytics is added to the build (REQ-014/017) -->
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&family=Libre+Baskerville:wght@700&family=Playfair+Display:ital,wght@0,700;0,900;1,700&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/site.css" />
<link rel="stylesheet" href="/blog-content.css" />
</head>
<body data-page="blog">
<main>
  <article class="wrap" style="max-width:760px;padding-top:120px;padding-bottom:80px">
    <a href="/blog/" style="opacity:.7;text-decoration:none">&larr; All articles</a>
    <h1 style="margin:18px 0 10px">${esc(post.title)}</h1>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px">
      <img src="${AUTHOR_PHOTO}" alt="${esc(post.author)}" loading="lazy" style="width:32px;height:32px;border-radius:50%;object-fit:cover;object-position:50% 20%;flex-shrink:0" />
      <span style="opacity:.7">By ${esc(post.author)}${published ? ` &middot; ${esc(fmtDate(published))}` : ''}</span>
    </div>
    ${(post.categories && post.categories.length) ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:28px">${post.categories.map((c) => `<a href="/blog/category/${catSlug(c)}/" style="font-size:.74rem;text-transform:uppercase;letter-spacing:.08em;color:var(--yellow);border:1px solid var(--line);padding:4px 11px;border-radius:4px;text-decoration:none">${esc(c)}</a>`).join('')}</div>` : ''}
    ${post.featured_image ? `<img src="${esc(post.featured_image)}" alt="${esc(post.featured_image_alt || post.title)}" style="width:100%;border-radius:10px;margin-bottom:28px" />` : ''}
    <div class="post-body">${post.body_html || ''}</div>${authorBio(post)}
  </article>

  ${membershipCta()}

  <section class="sec reach">
    <div class="wrap">
      <div class="shead" style="justify-content:center"><span class="kick">Work With Us</span></div>
      <h2 style="max-width:18em;margin:0 auto">Have a question, or interested in working with Raj?</h2>
      <a href="/#work" class="btn btn-y" style="margin-top:1.8rem">Get in touch <span class="ar">&rarr;</span></a>
    </div>
  </section>
${recent.length ? `  <section class="sec">
    <div class="wrap">
      <div class="shead"><span class="kick">Recent Posts</span><span class="ln"></span></div>
      <div class="blog-grid">${recent.map(recentCard).join('')}</div>
    </div>
  </section>` : ''}
</main>
<script src="/chrome.js"></script>
<script src="/common.js"></script>
</body>
</html>`;
}

export function renderNotFound() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Article not found - ${SITE_NAME}</title><meta name="robots" content="noindex" />
<link rel="stylesheet" href="/site.css" /></head>
<body data-page="blog"><main><article class="wrap" style="max-width:760px;padding:140px 0 100px;text-align:center">
<h1>Article not found</h1><p style="opacity:.75">That post doesn't exist or isn't published yet.</p>
<p><a href="/blog/">&larr; Back to all articles</a></p></article></main>
<script src="/chrome.js"></script><script src="/common.js"></script></body></html>`;
}
