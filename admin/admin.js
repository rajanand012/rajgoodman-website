/* Admin app for rajgoodman.com — extracted from admin/index.html so the code
   can be instrumented and unit-tested. Classic script (no modules), loaded via
   <script src> after the TipTap bundle; behavior-identical to the old inline
   script. All DOM wiring + boot live in wireAdmin(), which only runs in a
   browser; under Node the file instead exports its functions for tests. */
const $ = (id) => document.getElementById(id);
const DEFAULT_ROBOTS = 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';
const DEFAULT_OG_IMAGE = 'https://djpxdnxnvuokdfxlwktx.supabase.co/storage/v1/object/public/blog-media/wp-content/uploads/2025/06/Rectangle-2-1.webp';
let editor, current = null, slugEdited = false;

function toast(msg) { const t=$('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2200); }
function slugify(s){ return (s||'').toLowerCase().trim().replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,''); }

async function api(path, opts={}) {
  try {
    const r = await fetch(path, { headers:{'content-type':'application/json'}, ...opts });
    let body=null; try { body = await r.json(); } catch(e){}
    return { status:r.status, ok:r.ok, body };
  } catch (e) {
    // A network failure must surface as a normal error result, never an
    // unhandled rejection that leaves a view stuck on "Loading…".
    return { status:0, ok:false, body:null, netError:true };
  }
}
// Honest failure copy for list/dashboard loads — an API error must never
// masquerade as an empty state ("No posts yet").
function loadFailMsg(r){
  if (r && r.status===401) return 'Your session has expired — reload the page and sign in again.';
  if (r && r.netError) return 'Network error — check your connection and try again.';
  return 'Could not load (status '+((r&&r.status)||'?')+') — try again.';
}

let ME = null;            // { email, role }
let INVITE = null;        // { access_token, refresh_token } parsed from the invite link hash

// Invite/recovery links return in the URL hash — either valid tokens
// (#access_token=…&type=invite…) or, when expired/used, an error
// (#error=access_denied&error_code=otp_expired&error_description=…).
function parseHash(){
  const h = (location.hash || '').replace(/^#/, '');
  if (!h) return null;
  const p = new URLSearchParams(h);
  const at = p.get('access_token');
  if (at) return { access_token: at, refresh_token: p.get('refresh_token'), type: p.get('type') };
  const err = p.get('error_code') || p.get('error');
  if (err) return { error: err };
  return null;
}

async function boot() {
  const h = parseHash();
  if (h) history.replaceState(null, '', location.pathname);   // strip tokens/error from the URL bar
  if (h && h.access_token) {
    INVITE = h;
    $('setpw').classList.remove('hide');
    return;
  }
  const s = await api('/api/admin/session/');
  if (s.status === 200 && s.body && s.body.ok) { ME = s.body; showApp(); return; }
  if (h && h.error) {
    $('linkErr').textContent = (h.error === 'otp_expired')
      ? 'Your sign-in link has expired. Ask an admin (Raj or David) for a fresh one.'
      : 'That sign-in link is invalid or has already been used. Ask an admin (Raj or David) for a fresh one.';
    $('linkErr').classList.remove('hide');
  }
  $('login').classList.remove('hide');
}
function showApp(){
  $('login').classList.add('hide'); $('setpw').classList.add('hide');
  $('app').classList.remove('hide');
  $('whoami').textContent = ME ? ME.email : '';
  $('usersBtn').classList.toggle('hide', !ME || ME.role !== 'admin');
  try{ if(localStorage.getItem('wpfold')) $('app').classList.add('folded'); }catch(e){}
  showDashboard();
}
function setActiveMenu(id){ document.querySelectorAll('#adminmenu .item').forEach(a=>a.classList.toggle('current', a.id===id)); }
function hideViews(){ ['dashboardView','listView','editView','mediaView','usersView','linkedinView','coverageView'].forEach(v=>$(v).classList.add('hide')); }
async function showDashboard(){
  hideViews();
  $('dashboardView').classList.remove('hide'); setActiveMenu('navDashboard');
  const g=$('glance'); g.innerHTML='<p class="muted">Loading…</p>';
  // Post counts are a fast DB query — render those at once; fill the slower
  // media (bucket walk) and users counts in as they resolve, without blocking.
  const pr=await api('/api/admin/posts/');
  if(!pr.ok){ g.innerHTML='<p class="muted">'+esc(loadFailMsg(pr))+'</p>'; return; }
  const posts=(pr.body&&pr.body.posts)||[];
  const pub=posts.filter(p=>p.status==='published').length;
  const stats=[['Published',pub],['Drafts',posts.length-pub],['Media','…']];
  const usersIdx = (ME&&ME.role==='admin') ? stats.push(['Users','…'])-1 : -1;
  const render=()=>{ g.innerHTML=stats.map(s=>'<div class="stat"><div class="n">'+s[1]+'</div><div class="l">'+s[0]+'</div></div>').join(''); };
  render();
  fetchMedia().then(m=>{ stats[2][1]=(m===null?'—':m.length); render(); });
  if(usersIdx>=0) api('/api/admin/users/').then(ur=>{ stats[usersIdx][1]=((ur.body&&ur.body.users)||[]).length; render(); });
}


// ---- Users panel (admin only) ----
// Supabase's default email service only sends a handful of auth emails per
// hour (~2/h until custom SMTP is configured), so auto-retrying a refused
// send just counts down into the same wall. A rate-limited send is therefore
// reported, not retried: the #retryBar notice states the hourly allowance and
// roughly when the window reopens, and the admin resends manually.
const INVITE_HOURLY_LIMIT = 2;   // Supabase default-SMTP allowance, emails/hour
// Human wait time from the API's retryAfterSeconds. GoTrue only names a
// figure for the short per-address throttle; when the hourly pool itself is
// exhausted the API reports the full hour (3600).
function rateLimitWait(seconds){
  const s = Math.max(1, (seconds | 0) || 3600);
  if (s >= 3600) return 'about an hour';
  if (s >= 60) { const m = Math.ceil(s / 60); return `about ${m} minute${m > 1 ? 's' : ''}`; }
  return `about ${s} seconds`;
}
function showRateLimitNotice(retryAfterSeconds, note){
  const bar = $('retryBar');
  if (!bar) return;
  bar.innerHTML =
    '<p class="retry-head" role="status"><b>Email rate limit reached — email not sent.</b> ' +
    `Supabase's default email service sends at most ~${INVITE_HOURLY_LIMIT} auth emails per hour. ` +
    `Try again in ${rateLimitWait(retryAfterSeconds)}` + (note ? ' — ' + esc(note) : '.') + '</p>' +
    '<button type="button" class="retry-dismiss" aria-label="Dismiss notice">&times;</button>';
  bar.querySelector('.retry-dismiss').addEventListener('click', hideRateLimitNotice);
  bar.classList.remove('hide');
}
function hideRateLimitNotice(){
  const bar = $('retryBar');
  if (bar){ bar.classList.add('hide'); bar.innerHTML = ''; }
}

async function showUsers(){
  hideViews();
  $('usersView').classList.remove('hide'); setActiveMenu('usersBtn');
  const r = await api('/api/admin/users/');
  const tb = $('usersTable').querySelector('tbody'); tb.innerHTML='';
  if(!r.ok){ tb.innerHTML='<tr><td colspan="5" class="muted">'+esc(loadFailMsg(r))+'</td></tr>'; return; }
  const users = (r.body && r.body.users) || [];
  users.forEach(u => {
    const tr = document.createElement('tr');
    const last = u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleDateString() : '—';
    const status = u.confirmed ? 'active' : 'invited';
    const actionBtn = u.confirmed
      ? `<button data-reset="${u.id}" data-email="${esc(u.email)}">Send password reset</button> `
      : `<button data-resend="${u.id}" data-email="${esc(u.email)}">Resend invite</button> `;
    const delBtn = (u.email === (ME&&ME.email)) ? '' : `<button class="danger" data-del="${u.id}" data-email="${esc(u.email)}">Remove</button>`;
    tr.innerHTML = `<td>${esc(u.email)}</td><td>${esc(u.role)}</td><td class="muted">${status}</td><td class="muted">${last}</td><td>${actionBtn}${delBtn}</td>`;
    tb.appendChild(tr);
  });
  tb.querySelectorAll('[data-resend]').forEach(b => b.addEventListener('click', () => resendInvite(b.dataset.resend, b.dataset.email, b)));
  tb.querySelectorAll('[data-reset]').forEach(b => b.addEventListener('click', () => sendReset(b.dataset.reset, b.dataset.email, b)));
  tb.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm(`Remove ${b.dataset.email}? They will lose access immediately.`)) return;
    const r = await api('/api/admin/users/', { method:'DELETE', body: JSON.stringify({ id: b.dataset.del }) });
    if (r.ok) showUsers(); else toast('Could not remove user');
  }));
}

// Re-send a pending invite (PATCH). A rate-limited send is reported via the
// notice bar and left for the admin to retry manually. When the API had to
// recreate the pending user before being limited (`recreate`), that row is
// gone — prefill the invite form so the manual retry is one click away.
async function resendInvite(id, email, btn){
  if (btn) btn.disabled = true;
  const r = await api('/api/admin/users/', { method:'PATCH', body: JSON.stringify({ id }) });
  if (r.ok && r.body && r.body.ok) {
    hideRateLimitNotice();
    toast(`Invite re-sent to ${email}`);
    showUsers();
    return;
  }
  if (btn) btn.disabled = false;
  if (r.status === 429 && r.body && r.body.error === 'rate-limited') {
    if (r.body.recreate) {
      $('inv_email').value = r.body.email;
      $('inv_role').value = r.body.role;
      showRateLimitNotice(r.body.retryAfterSeconds,
        `the pending invite for ${r.body.email} was cleared along the way; the form above is prefilled — just hit "Send invite"`);
      showUsers();   // that row no longer exists — don't leave a stale table
    } else {
      showRateLimitNotice(r.body.retryAfterSeconds);
    }
    return;
  }
  toast('Could not resend' + (r.body && r.body.detail ? ': ' + r.body.detail : ' — try again'));
}

// Password reset for an active user (PUT) — rescues accounts confirmed by the
// old broken invite link that never got to choose a password, without
// deleting anything. The reset link lands on /admin/, which already shows the
// set-password screen for recovery tokens.
async function sendReset(id, email, btn){
  if (btn) btn.disabled = true;
  const r = await api('/api/admin/users/', { method:'PUT', body: JSON.stringify({ id }) });
  if (btn) btn.disabled = false;
  if (r.ok && r.body && r.body.ok) { hideRateLimitNotice(); toast(`Password reset sent to ${email}`); return; }
  if (r.status === 429 && r.body && r.body.error === 'rate-limited') { showRateLimitNotice(r.body.retryAfterSeconds); return; }
  toast('Could not send reset' + (r.body && r.body.detail ? ': ' + r.body.detail : ' — try again'));
}

async function loadList() {
  hideViews(); $('listView').classList.remove('hide'); setActiveMenu('navPosts');
  const r = await api('/api/admin/posts/');
  const tb = $('postsTable').querySelector('tbody'); tb.innerHTML='';
  if(!r.ok){ const m=$('emptyMsg'); m.textContent=loadFailMsg(r); m.classList.remove('hide'); return; }
  const posts = (r.body && r.body.posts) || [];
  $('emptyMsg').textContent='No posts yet — create one.';
  $('emptyMsg').classList.toggle('hide', posts.length>0);
  posts.forEach(p => {
    const tr = document.createElement('tr');
    const mod = p.modified_at ? new Date(p.modified_at).toLocaleDateString() : '';
    tr.innerHTML = `<td><a class="link" href="#" data-id="${p.id}">${esc(p.title)}</a></td>
      <td class="muted">/blog/${esc(p.slug)}/</td>
      <td><span class="pill ${p.status}">${p.status}</span></td>
      <td class="muted">${mod}</td>
      <td><button data-edit="${p.id}">Edit</button></td>`;
    tb.appendChild(tr);
  });
  tb.querySelectorAll('[data-edit],[data-id]').forEach(el => el.addEventListener('click', (e)=>{ e.preventDefault(); openEditor(el.getAttribute('data-edit')||el.getAttribute('data-id')); }));
  // Refresh the category picker's known set from existing posts.
  CAT_ALL=[...new Set(posts.flatMap(p=>p.categories||[]))].sort((a,b)=>a.localeCompare(b));
  renderCats();
}
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

// Build (or rebuild) the editor with the post body baked in at construction —
// ProseMirror renders initial content reliably on mount, whereas setContent run
// in the click→openEditor flow does not populate the view.
// Custom CTA block node (atom): renders a themed call-to-action card from
// heading/text/label/url attrs; round-trips via data-* attributes.
let _ctaNode;
function ctaNode(){
  if(_ctaNode) return _ctaNode;
  const { Node } = window.TipTap;
  _ctaNode = Node.create({
    name:'cta', group:'block', atom:true, selectable:true, draggable:true,
    addAttributes(){ return {
      heading:{ default:'', parseHTML:el=>el.getAttribute('data-heading')||'' },
      text:{ default:'', parseHTML:el=>el.getAttribute('data-text')||'' },
      label:{ default:'Get in touch', parseHTML:el=>el.getAttribute('data-label')||'Get in touch' },
      url:{ default:'/#work', parseHTML:el=>el.getAttribute('data-url')||'/#work' },
    }; },
    parseHTML(){ return [{ tag:'div[data-cta]' }]; },
    renderHTML({ node }){ const a=node.attrs; return ['div',
      { 'data-cta':'', class:'post-cta', 'data-heading':a.heading, 'data-text':a.text, 'data-label':a.label, 'data-url':a.url },
      ['div',{ class:'post-cta-h' }, a.heading], ['p',{}, a.text], ['a',{ class:'post-cta-btn', href:a.url }, a.label] ]; },
  });
  return _ctaNode;
}
function insertCTA(h,t,l,u){
  if(!editor) return;
  editor.chain().focus().insertContent([{ type:'cta', attrs:{ heading:h||'', text:t||'', label:l||'Get in touch', url:u||'/#work' } }, { type:'paragraph' }]).run();
  $('tt-ctabar').style.display='none'; ['cta-h','cta-t','cta-l','cta-u'].forEach(id=>$(id).value='');
}

// Form block node (atom): renders the site's real contact/newsletter form markup
// (data-form + data-turnstile). On the published page, common.js auto-wires it +
// loads Turnstile. Submits to /api/contact/ (DealDesk) or /api/subscribe/ (EmailOctopus).
const FORM_HTML = {
  contact: '<form data-form="contact" class="post-form"><div class="row2"><div class="fld"><label>Name *</label><input name="name" required placeholder="Your name"></div><div class="fld"><label>Email Address *</label><input name="email" type="email" required placeholder="you@company.com"></div></div><div class="fld"><label>Services *</label><select name="service" required><option value="">— Please choose an option —</option><option>AI for Business Leaders</option><option>AI Consulting</option><option>AI Trainer</option><option>Executive Training</option><option>Fractional Chief AI Officer</option><option>Organizational Transformation</option></select></div><div class="fld"><label>Message *</label><textarea name="message" required placeholder="Tell Raj about your goals…"></textarea></div><div data-turnstile style="margin:6px 0 18px"></div><button class="btn btn-y" type="submit">Send message <span class="ar">→</span></button></form>',
  newsletter: '<form data-form="newsletter" class="post-form"><div class="row2"><div class="fld"><input name="firstName" required placeholder="First Name"></div><div class="fld"><input name="lastName" required placeholder="Last Name"></div></div><div class="fld"><input name="email" type="email" required placeholder="Email"></div><div data-turnstile style="margin:6px 0 18px"></div><button class="btn btn-y" type="submit">Join the Newsletter <span class="ar">→</span></button></form>',
};
let _formNode;
function formNode(){
  if(_formNode) return _formNode;
  const { Node } = window.TipTap;
  _formNode = Node.create({
    name:'leadform', group:'block', atom:true, selectable:true, draggable:true,
    addAttributes(){ return { kind:{ default:'contact', parseHTML:el=>el.getAttribute('data-form')||'contact' } }; },
    parseHTML(){ return [{ tag:'form[data-form]' }]; },
    renderHTML({ node }){ const d=document.createElement('div'); d.innerHTML=FORM_HTML[node.attrs.kind]||FORM_HTML.contact; return d.firstElementChild; },
  });
  return _formNode;
}
function insertForm(kind){
  if(!editor) return;
  editor.chain().focus().insertContent([{ type:'leadform', attrs:{ kind } }, { type:'paragraph' }]).run();
  $('tt-formbar').style.display='none';
}
function mountEditor(html){
  const { Editor, StarterKit, Link, Image, Placeholder, Details, DetailsSummary, DetailsContent, Youtube } = window.TipTap;
  if(editor){ editor.destroy(); editor = null; }
  editor = new Editor({
    element: $('editor'),
    extensions: [
      StarterKit.configure({ heading:{ levels:[2,3] } }),
      Link.configure({ openOnClick:false, autolink:true, protocols:['http','https','mailto'], HTMLAttributes:{ rel:'noopener noreferrer', target:null } }),
      Image.configure({ inline:false }),
      Placeholder.configure({ placeholder:'Write your post…' }),
      Details.configure({ persist:false, HTMLAttributes:{ class:'faq-item' } }),
      DetailsSummary,
      DetailsContent,
      Youtube.configure({ controls:true, nocookie:true, width:640, height:360 }),
      ctaNode(),
      formNode(),
    ],
    content: html || '',
    onUpdate: runSeoChecks,
    onSelectionUpdate: updateToolbarActive,
    onTransaction: updateToolbarActive,
  });
  updateToolbarActive();
}
function ttCmd(cmd){
  if(!editor) return;
  const c = editor.chain().focus();
  if(cmd==='h2') c.toggleHeading({level:2}).run();
  else if(cmd==='h3') c.toggleHeading({level:3}).run();
  else if(cmd==='bold') c.toggleBold().run();
  else if(cmd==='italic') c.toggleItalic().run();
  else if(cmd==='bullet') c.toggleBulletList().run();
  else if(cmd==='ordered') c.toggleOrderedList().run();
  else if(cmd==='quote') c.toggleBlockquote().run();
  else if(cmd==='code') c.toggleCodeBlock().run();
  else if(cmd==='hr') c.setHorizontalRule().run();
  else if(cmd==='link'){
    const prev = editor.getAttributes('link').href || '';
    const url = prompt('Link URL (leave blank to remove)', prev);
    if(url===null) return;
    if(url==='') editor.chain().focus().extendMarkRange('link').unsetLink().run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href:url }).run();
  }
  else if(cmd==='image') openMedia((url,f)=>{ const at={ src:url }; if(f&&f.alt) at.alt=f.alt; editor.chain().focus().setImage(at).run(); if(!at.alt) editImageAlt(url); });
  else if(cmd==='faq') addFaqItem();
  else if(cmd==='video'){ const bar=$('tt-videobar'); bar.style.display='flex'; const inp=$('tt-videourl'); inp.value=''; inp.focus(); return; }
  else if(cmd==='cta'){ const bar=$('tt-ctabar'); bar.style.display='flex'; $('cta-h').focus(); return; }
  else if(cmd==='form'){ $('tt-formbar').style.display='flex'; return; }
  updateToolbarActive();
}
function updateToolbarActive(){
  if(!editor) return;
  const a = {
    h2:editor.isActive('heading',{level:2}), h3:editor.isActive('heading',{level:3}),
    bold:editor.isActive('bold'), italic:editor.isActive('italic'), link:editor.isActive('link'),
    bullet:editor.isActive('bulletList'), ordered:editor.isActive('orderedList'),
    quote:editor.isActive('blockquote'), code:editor.isActive('codeBlock'), faq:editor.isActive('details'),
  };
  document.querySelectorAll('#tt-toolbar button[data-cmd]').forEach(b=>b.classList.toggle('active', !!a[b.getAttribute('data-cmd')]));
  // Alt-text bar: shown whenever an image node is selected, prefilled with its alt.
  const altBar=$('tt-altbar'), onImg=editor.isActive('image');
  if(onImg && document.activeElement!==$('tt-altinput')) $('tt-altinput').value = editor.getAttributes('image').alt || '';
  altBar.style.display = onImg ? 'flex' : 'none';
  if(onImg) positionAltBar(); else dockAltBar(altBar);
}

// The alt bar floats beside the image being edited rather than sitting at the
// top of the editor: on a long post the image you clicked is often nowhere near
// the toolbar, and scrolling up to type alt text and back down is miserable.
// Falls back to the docked position if the image element cannot be located.
function selectedImageEl(){
  const view = editor && editor.view;
  const dom = view && view.dom;
  if(!dom || !dom.querySelector) return null;
  // ProseMirror marks the node-selected element; fall back to matching on src.
  let img = dom.querySelector('img.ProseMirror-selectednode');
  if(!img){
    const src = (editor.getAttributes('image')||{}).src;
    if(src && dom.querySelectorAll){
      const all = dom.querySelectorAll('img');
      for(let i=0;i<all.length;i++){ if(all[i].getAttribute('src')===src){ img=all[i]; break; } }
    }
  }
  return img && img.getBoundingClientRect ? img : null;
}
function dockAltBar(bar){
  if(!bar || !bar.style) return;
  bar.style.position=''; bar.style.left=''; bar.style.top=''; bar.style.width='';
  bar.style.zIndex=''; bar.style.boxShadow=''; bar.style.borderRadius=''; bar.style.borderBottom='';
}
function positionAltBar(){
  const bar=$('tt-altbar');
  if(!bar || !bar.style) return;
  const img=selectedImageEl();
  if(!img || typeof window==='undefined'){ dockAltBar(bar); return; }
  const r=img.getBoundingClientRect();
  const w=Math.max(260, Math.min(520, window.innerWidth-24));
  let left=r.left+(r.width-w)/2;
  left=Math.max(12, Math.min(left, window.innerWidth-w-12));
  // Prefer just under the image; flip above if that would fall off-screen.
  let top=r.bottom+8;
  if(top+64 > window.innerHeight) top=Math.max(12, r.top-64);
  bar.style.position='fixed'; bar.style.zIndex='40';
  bar.style.left=Math.round(left)+'px'; bar.style.top=Math.round(top)+'px';
  bar.style.width=Math.round(w)+'px';
  bar.style.borderBottom='1px solid var(--acc)';
  bar.style.border='1px solid var(--acc)';
  bar.style.borderRadius='4px';
  bar.style.boxShadow='0 6px 20px rgba(0,0,0,.18)';
}
// Add an FAQ. setDetails() is a no-op when the cursor is already inside one, so
// clicking FAQ repeatedly used to add only the first: you had to click out of
// the block each time. Step out to the end of the current FAQ first, so the
// button always adds another one and a whole set can be built in a few clicks.
// Append another FAQ to the end of the post.
//
// setDetails() only wraps the CURRENT block, so it is a no-op once the cursor
// is inside an FAQ — which meant the button added the first item and then
// appeared to do nothing. Inserting the markup instead goes through the same
// parser that reads FAQs when a post loads, so it works from anywhere in the
// document and each click reliably adds one.
const FAQ_TEMPLATE = '<details class="faq-item"><summary>New question</summary>'
  + '<div data-type="detailsContent"><p>Answer goes here.</p></div></details>';
function addFaqItem(){
  if(!editor) return;
  editor.chain().focus()
    .insertContentAt(editor.state.doc.content.size, FAQ_TEMPLATE)
    .run();
}

function applyImageAlt(){
  if(!editor || !editor.isActive('image')) return;
  editor.chain().focus().updateAttributes('image', { alt: $('tt-altinput').value.trim() }).run();
}
// Select an image node by src and reveal the alt-text bar focused on it, so alt
// can be added/edited inline in the editor (no need to open the Media library).
function editImageAlt(src){
  if(!editor) return;
  let pos=null;
  editor.state.doc.descendants((n,p)=>{ if(n.type.name==='image' && n.attrs.src===src) pos=p; });
  if(pos==null) return;
  editor.chain().setNodeSelection(pos).run();
  updateToolbarActive();
  const inp=$('tt-altinput'); if(inp){ inp.focus(); inp.select(); }
}

// --- Image upload (signed URL → direct PUT to Supabase Storage) + media library ---

// Client-side compression: re-encode raster uploads to WebP q85 (the same
// standard as the committed /assets images) and downscale anything larger than
// IMG_MAX_DIM on its long edge, BEFORE the direct-to-storage PUT. Animated GIFs,
// SVGs and non-images pass through untouched, and it falls back to the original
// on any failure or if WebP doesn't actually shrink the file - so an upload can
// never fail because of compression.
const IMG_QUALITY = 0.85, IMG_MAX_DIM = 2000;
async function compressImage(file){
  if(!file || !/^image\/(png|jpe?g|webp)$/i.test(file.type)) return file;
  if(typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;
  try{
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, IMG_MAX_DIM / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width*scale)), h = Math.max(1, Math.round(bmp.height*scale));
    const canvas = document.createElement('canvas'); canvas.width=w; canvas.height=h;
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
    if(bmp.close) bmp.close();
    const blob = await new Promise(res=> canvas.toBlob(res, 'image/webp', IMG_QUALITY));
    if(!blob || blob.size >= file.size) return file; // already small/webp → keep original
    const base = (file.name||'image').replace(/\.[a-z0-9]+$/i,'');
    return new File([blob], base+'.webp', { type:'image/webp' });
  }catch(e){ return file; }
}

async function uploadFile(file){
  file = await compressImage(file);
  const sign = await api('/api/admin/upload/', { method:'POST', body: JSON.stringify({ filename:file.name, contentType:file.type }) });
  if(!sign.ok) throw new Error((sign.body&&sign.body.error)||'upload-failed');
  const put = await fetch(sign.body.signedUrl, { method:'PUT', headers:{'content-type':file.type}, body:file });
  if(!put.ok) throw new Error('put-failed');
  return sign.body.publicUrl;
}
function pickFile(cb){ const i=document.createElement('input'); i.type='file'; i.accept='image/png,image/jpeg,image/webp,image/gif'; i.onchange=()=>{ if(i.files[0]) cb(i.files[0]); }; i.click(); }
// Shared media list (recursive bucket list + alt/caption/title metadata).
// Cached after first load so switching panes is instant; pass force=true after uploads.
let MEDIA = [], MEDIA_LOADED = false;
// Returns the file list, or null when the load FAILED (callers must show an
// error, not an empty library). Failure is not cached so a retry refetches.
async function fetchMedia(force){
  if(MEDIA_LOADED && !force) return MEDIA;
  const r=await api('/api/admin/media/');
  if(!r.ok){ MEDIA=[]; MEDIA_LOADED=false; return null; }
  MEDIA=(r.body&&r.body.files)||[]; MEDIA_LOADED=true; return MEDIA;
}

// --- In-editor picker modal: choose an existing image (or upload), then onPick(url, file) ---
let mediaPick = null;
function openMedia(onPick){ mediaPick=onPick; $('mediaModal').style.display='flex'; loadMedia(); }
function closeMedia(){ $('mediaModal').style.display='none'; mediaPick=null; }
async function loadMedia(){
  const grid=$('mediaGrid'); grid.innerHTML='<p class="muted">Loading…</p>';
  const files=await fetchMedia();
  if(files===null){ grid.innerHTML='<p class="muted">'+esc(loadFailMsg({}))+'</p>'; return; }
  $('mediaEmpty').classList.toggle('hide', files.length>0); grid.innerHTML='';
  files.forEach(f=>{ const b=document.createElement('button'); b.type='button'; b.title=f.alt?f.name+' — '+f.alt:f.name;
    b.style.cssText='padding:0;border:1px solid var(--bd);border-radius:8px;overflow:hidden;aspect-ratio:1/1;background:#eef0f2;cursor:pointer';
    b.innerHTML='<img src="'+esc(f.url)+'" alt="'+esc(f.alt||f.name)+'" style="width:100%;height:100%;object-fit:cover" />';
    b.addEventListener('click',()=>{ if(mediaPick) mediaPick(f.url, f); closeMedia(); }); grid.appendChild(b); });
}

// --- Standalone Media Library view (nav: Media) ---
let mediaSelected = null;
function showMedia(){
  hideViews();
  $('mediaView').classList.remove('hide'); setActiveMenu('mediaBtn');
  loadMediaLibrary();
}
async function loadMediaLibrary(){
  $('mediaViewLoading').classList.remove('hide'); $('mediaViewEmpty').classList.add('hide');
  $('mediaViewGrid').innerHTML=''; $('mediaDetail').classList.add('hide'); mediaSelected=null;
  const files=await fetchMedia();
  $('mediaViewLoading').classList.add('hide');
  if(files===null){ const e=$('mediaViewEmpty'); e.textContent=loadFailMsg({}); e.classList.remove('hide'); return; }
  renderMediaLibrary();
}
function renderMediaLibrary(){
  const q=($('mediaSearch').value||'').toLowerCase().trim();
  const files=MEDIA.filter(f=>!q||f.name.toLowerCase().includes(q)||(f.alt||'').toLowerCase().includes(q));
  $('mediaCount').textContent = MEDIA.length ? '· '+files.length+(q?' of '+MEDIA.length:'')+' item'+(files.length===1?'':'s') : '';
  $('mediaViewEmpty').classList.toggle('hide', MEDIA.length>0);
  const grid=$('mediaViewGrid'); grid.innerHTML='';
  files.forEach(f=>{ const b=document.createElement('button'); b.type='button'; b.title=f.name;
    b.className='media-tile'+(mediaSelected&&mediaSelected.path===f.path?' selected':'');
    b.innerHTML='<img src="'+esc(f.url)+'" alt="'+esc(f.alt||f.name)+'" loading="lazy" />'
      +'<span class="check">✓</span>'+(f.alt?'':'<span class="noalt">NO ALT</span>');
    b.addEventListener('click',()=>showMediaDetail(f)); grid.appendChild(b); });
}
function fmtSize(n){ if(!n) return '—'; const u=['B','KB','MB']; let i=0,v=n; while(v>=1024&&i<u.length-1){v/=1024;i++;} return (v<10&&i>0?v.toFixed(1):Math.round(v))+' '+u[i]; }
function fmtDate(s){ if(!s) return '—'; const d=new Date(s); return isNaN(d)?'—':d.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}); }
function extOf(name){ const m=(name||'').match(/\.([a-z0-9]+)$/i); return m?m[1].toUpperCase():'—'; }
function showMediaDetail(f){
  mediaSelected=f; renderMediaLibrary();
  const isAdmin = ME && ME.role==='admin';
  const d=$('mediaDetail'); d.classList.remove('hide');
  d.innerHTML =
    '<img class="preview" id="mdImg" src="'+esc(f.url)+'" alt="'+esc(f.alt||f.name)+'" />'
    + '<div class="info" style="word-break:break-all"><b>'+esc(f.name)+'</b></div>'
    + '<div class="info">'+extOf(f.name)+' · <span id="mdDims">…</span> · '+fmtSize(f.size)+'</div>'
    + '<div class="info">Uploaded '+fmtDate(f.created_at)+'</div>'
    + '<button type="button" id="mdCopy" style="width:100%;margin:10px 0 2px">Copy URL</button>'
    + (isAdmin?'<button type="button" id="mdReplace" style="width:100%;margin:6px 0 2px">Replace image&hellip;</button>':'')
    + '<h4>Details</h4>'
    + '<label style="margin-top:0">Alt text</label><textarea id="mdAlt" rows="2"></textarea>'
    + '<label>Title</label><input id="mdTitle" />'
    + '<label>Caption</label><input id="mdCaption" />'
    + '<button type="button" id="mdSave" class="primary" style="width:100%;margin-top:12px">Save details</button>'
    + (isAdmin?'<button type="button" id="mdDelete" class="danger" style="width:100%;margin-top:8px">Delete permanently</button>':'');
  $('mdAlt').value=f.alt||''; $('mdCaption').value=f.caption||''; $('mdTitle').value=f.title||'';
  const _img=$('mdImg'), setDims=()=>{ if(_img.naturalWidth) $('mdDims').textContent=_img.naturalWidth+'×'+_img.naturalHeight; };
  if(_img.complete) setDims(); else _img.addEventListener('load', setDims);
  $('mdCopy').addEventListener('click',()=>{ navigator.clipboard.writeText(f.url).then(()=>toast('URL copied'),()=>toast('Copy failed')); });
  $('mdSave').addEventListener('click',async()=>{
    const patch={ path:f.path, alt:$('mdAlt').value.trim(), caption:$('mdCaption').value.trim(), title:$('mdTitle').value.trim() };
    const r=await api('/api/admin/media/',{ method:'PATCH', body:JSON.stringify(patch) });
    if(r.ok){ Object.assign(f,patch); toast('Saved'); renderMediaLibrary(); }
    else toast('Save failed'+((r.body&&r.body.error)?' — '+r.body.error:''));
  });
  if(isAdmin) $('mdReplace').addEventListener('click',()=>replaceMedia(f));
  if(isAdmin) $('mdDelete').addEventListener('click',()=>deleteMedia(f));
}
// Replace an image everywhere: upload the new file, then repoint all references
// to it (same as re-cropping and having every post/widget follow the latest).
async function replaceMedia(f){
  pickFile(async(file)=>{
    let newUrl;
    try{ toast('Uploading…'); newUrl=await uploadFile(file); }
    catch(e){ return toast('Upload failed'); }
    const newPath=newUrl.split('/blog-media/').pop();
    const r=await api('/api/admin/media/',{ method:'POST', body:JSON.stringify({ action:'replace', oldPath:f.path, newPath }) });
    if(r.ok){
      const c=r.body.counts||{}; const n=(c.linkedin||0)+(c.posts||0);
      toast('Replaced'+(n?' — updated '+n+' reference'+(n===1?'':'s'):''));
      MEDIA_LOADED=false; await loadMediaLibrary();
    } else toast('Replace failed'+((r.body&&r.body.error)?' — '+r.body.error:''));
  });
}
async function deleteMedia(f, force){
  if(!force && !confirm('Delete '+f.name+' permanently?')) return;
  const r=await api('/api/admin/media/',{ method:'DELETE', body:JSON.stringify({ path:f.path, force:!!force }) });
  if(r.status===409 && r.body && r.body.posts){
    const list=r.body.posts.map(p=>'• '+p.title).join('\n');
    if(confirm('This image is used in '+r.body.posts.length+' post(s):\n\n'+list+'\n\nDelete anyway? Those posts will show a broken image.')) return deleteMedia(f, true);
    return;
  }
  if(r.ok){ toast('Deleted'); MEDIA=MEDIA.filter(x=>x.path!==f.path); $('mediaDetail').classList.add('hide'); mediaSelected=null; renderMediaLibrary(); }
  else toast('Delete failed');
}

// ---- LinkedIn posts manager ----
let LINKEDIN=[], liEditing=null;
function showLinkedin(){ hideViews(); $('linkedinView').classList.remove('hide'); setActiveMenu('navLinkedin'); loadLinkedin(); }
async function loadLinkedin(){
  liCloseForm();
  const r=await api('/api/admin/linkedin/');
  const tb=$('liTable').querySelector('tbody'); tb.innerHTML='';
  if(!r.ok){ LINKEDIN=[]; const e=$('liEmpty'); e.textContent=loadFailMsg(r); e.classList.remove('hide'); $('liTable').classList.add('hide'); return; }
  LINKEDIN=(r.body&&r.body.posts)||[];
  $('liEmpty').textContent='No LinkedIn posts yet — Add one.';
  $('liEmpty').classList.toggle('hide', LINKEDIN.length>0);
  $('liTable').classList.toggle('hide', LINKEDIN.length===0);
  LINKEDIN.forEach((p,i)=>{ const tr=document.createElement('tr');
    tr.innerHTML='<td><div style="width:44px;height:44px;border-radius:4px;overflow:hidden;background:#f0f0f1"><img src="'+esc(p.image_url||'')+'" alt="" style="width:100%;height:100%;object-fit:cover" /></div></td>'
      +'<td><div style="font-weight:600">'+esc(p.title||'(untitled)')+'</div><a class="link" href="'+esc(p.url)+'" target="_blank" rel="noopener" style="font-size:12px;word-break:break-all">'+esc(p.url)+'</a></td>'
      +'<td><button type="button" data-vis="'+p.id+'" class="'+(p.visible?'primary':'')+'" style="min-height:26px;padding:0 10px">'+(p.visible?'On':'Off')+'</button></td>'
      +'<td style="white-space:nowrap"><button type="button" data-up="'+p.id+'" '+(i===0?'disabled':'')+' style="min-height:26px;padding:0 9px">&uarr;</button> <button type="button" data-down="'+p.id+'" '+(i===LINKEDIN.length-1?'disabled':'')+' style="min-height:26px;padding:0 9px">&darr;</button></td>'
      +'<td class="actions"><button type="button" data-edit="'+p.id+'">Edit</button><button type="button" data-del="'+p.id+'" class="danger">Delete</button></td>';
    tb.appendChild(tr);
  });
  tb.querySelectorAll('[data-vis]').forEach(b=>b.addEventListener('click',()=>liToggle(b.dataset.vis)));
  tb.querySelectorAll('[data-up]').forEach(b=>b.addEventListener('click',()=>liMove(b.dataset.up,-1)));
  tb.querySelectorAll('[data-down]').forEach(b=>b.addEventListener('click',()=>liMove(b.dataset.down,1)));
  tb.querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click',()=>liOpenForm(LINKEDIN.find(x=>String(x.id)===b.dataset.edit))));
  tb.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click',()=>liDelete(b.dataset.del)));
}
function liOpenForm(p){ liEditing=p||null; $('liForm').classList.remove('hide');
  $('li_url').value=p?p.url:''; $('li_title').value=p?(p.title||''):''; $('li_image').value=p?(p.image_url||''):''; $('li_visible').checked=p?!!p.visible:true; liPreview(); $('li_url').focus(); }
function liCloseForm(){ $('liForm').classList.add('hide'); liEditing=null; }
function liPreview(){ $('li_preview').src=$('li_image').value.trim()||''; }
async function liFetchMeta(){ const url=$('li_url').value.trim(); if(!url){ toast('Paste a URL first'); return; } toast('Fetching…');
  const r=await api('/api/admin/fetch-meta/?url='+encodeURIComponent(url));
  if(r.ok&&r.body&&r.body.title){ $('li_title').value=r.body.title; toast('Title fetched'); } else toast('Could not fetch title'); }
async function liSave(){ const row={ url:$('li_url').value.trim(), title:$('li_title').value.trim(), image_url:$('li_image').value.trim(), visible:$('li_visible').checked };
  if(!row.url){ toast('URL is required'); return; }
  let r;
  if(liEditing){ row.id=liEditing.id; r=await api('/api/admin/linkedin/',{method:'PATCH',body:JSON.stringify(row)}); }
  else { row.sort_order=LINKEDIN.reduce((m,p)=>Math.max(m,p.sort_order||0),0)+1; r=await api('/api/admin/linkedin/',{method:'POST',body:JSON.stringify(row)}); }
  if(r.ok){ toast('Saved'); loadLinkedin(); } else toast('Save failed'+((r.body&&r.body.detail)?': '+r.body.detail:'')); }
async function liToggle(id){ const p=LINKEDIN.find(x=>String(x.id)===String(id)); if(!p) return;
  const r=await api('/api/admin/linkedin/',{method:'PATCH',body:JSON.stringify({id:p.id,visible:!p.visible})}); if(r.ok) loadLinkedin(); }
async function liMove(id,dir){ const i=LINKEDIN.findIndex(x=>String(x.id)===String(id)); const j=i+dir; if(i<0||j<0||j>=LINKEDIN.length) return;
  const a=LINKEDIN[i], b=LINKEDIN[j];
  await api('/api/admin/linkedin/',{method:'PATCH',body:JSON.stringify({id:a.id,sort_order:b.sort_order})});
  await api('/api/admin/linkedin/',{method:'PATCH',body:JSON.stringify({id:b.id,sort_order:a.sort_order})});
  loadLinkedin(); }
async function liDelete(id){ if(!confirm('Delete this LinkedIn post?')) return;
  const r=await api('/api/admin/linkedin/',{method:'DELETE',body:JSON.stringify({id})}); if(r.ok){ toast('Deleted'); loadLinkedin(); } else toast('Delete failed'); }

// --- Category picker (WordPress-style checkbox list; CAT_ALL = known set, CAT_SEL = this post's) ---
let CAT_ALL=[], CAT_SEL=new Set();
function renderCats(){
  const box=$('f_catbox');
  if(!CAT_ALL.length){ box.innerHTML='<span class="muted">No categories yet — add one below.</span>'; return; }
  box.innerHTML=CAT_ALL.map(c=>'<label style="display:flex;align-items:center;gap:8px;font-weight:400;margin:4px 0;cursor:pointer"><input type="checkbox" style="width:auto;margin:0" data-cat="'+esc(c)+'"'+(CAT_SEL.has(c)?' checked':'')+' /> '+esc(c)+'</label>').join('');
}
function addNewCat(){
  const v=$('f_catnew').value.trim(); if(!v) return;
  const existing=CAT_ALL.find(c=>c.toLowerCase()===v.toLowerCase());
  if(!existing){ CAT_ALL.push(v); CAT_ALL.sort((a,b)=>a.localeCompare(b)); }
  CAT_SEL.add(existing||v); $('f_catnew').value=''; renderCats();
}

async function openEditor(id) {
  hideViews(); $('editView').classList.remove('hide'); setActiveMenu('navPosts');
  slugEdited = false;
  if (id) {
    const r = await api('/api/admin/posts/?id='+encodeURIComponent(id));
    current = r.body.posts;
  } else {
    current = { status:'draft', author:'Raj Goodman Anand', robots:DEFAULT_ROBOTS };
  }
  fill(current);
}
function fill(p){
  $('f_title').value=p.title||''; $('f_slug').value=p.slug||'';
  $('f_seo_title').value=p.seo_title||''; $('f_meta_description').value=p.meta_description||'';
  $('f_excerpt').value=p.excerpt||''; $('f_featured_image').value=p.featured_image||'';
  $('f_featured_image_alt').value=p.featured_image_alt||''; $('f_author').value=p.author||'Raj Goodman Anand';
  $('f_focus_keyphrase').value=p.focus_keyphrase||''; $('f_canonical_url').value=p.canonical_url||'';
  CAT_SEL=new Set(p.categories||[]);
  (p.categories||[]).forEach(c=>{ if(!CAT_ALL.some(x=>x.toLowerCase()===c.toLowerCase())) CAT_ALL.push(c); });
  CAT_ALL.sort((a,b)=>a.localeCompare(b)); renderCats();
  $('f_robots').value=p.robots||DEFAULT_ROBOTS;
  $('f_noindex').checked = /noindex/i.test(p.robots||DEFAULT_ROBOTS);
  $('f_og_title').value=p.og_title||''; $('f_og_description').value=p.og_description||''; $('f_og_image').value=p.og_image||'';
  mountEditor(p.body_html || '');
  slugEdited = !!p.slug;
  refreshMeta();
  const pub = p.status==='published';
  $('statusPill').innerHTML = p.id ? `<span class="pill ${p.status}">${p.status}</span>` : '';
  $('unpubBtn').classList.toggle('hide', !pub);
  $('deleteBtn').classList.toggle('hide', !p.id);
  $('publishBtn').classList.toggle('hide', pub);
}
function colorFor(len, min, max){ if(!len) return 'var(--mut)'; if(len<min) return '#b9770e'; if(len<=max) return '#1a7f37'; return '#b42318'; }
function refreshMeta(){
  $('slugPreview').textContent = $('f_slug').value||'…';
  const tl = $('f_seo_title').value.length, dl = $('f_meta_description').value.length;
  $('c_seo').textContent = tl; $('c_seo').style.color = colorFor(tl, 50, 60);
  $('c_desc').textContent = dl; $('c_desc').style.color = colorFor(dl, 120, 160);
  updatePreview();
  runSeoChecks();
}
function updatePreview(){
  const slug = $('f_slug').value.trim();
  const seoTitle = $('f_seo_title').value.trim() || $('f_title').value.trim() || 'Untitled post';
  const seoDesc = $('f_meta_description').value.trim() || $('f_excerpt').value.trim() || '';
  const url = $('f_canonical_url').value.trim() || ('https://rajgoodman.com/blog/' + slug + '/');
  $('pv_url').textContent = url.replace(/^https?:\/\//,'').replace(/\/+$/,'').replace(/\//g,' › ');
  $('pv_title').textContent = seoTitle;
  $('pv_desc').textContent = seoDesc;
  // Social card honours per-post OG overrides, else the SEO fields / featured image.
  $('pv_stitle').textContent = $('f_og_title').value.trim() || seoTitle;
  $('pv_sdesc').textContent = $('f_og_description').value.trim() || seoDesc;
  $('pv_img').src = $('f_og_image').value.trim() || $('f_featured_image').value.trim() || DEFAULT_OG_IMAGE;
}
function plainText(html){ const d=document.createElement('div'); d.innerHTML=html||''; return (d.textContent||'').replace(/\s+/g,' ').trim(); }
function runSeoChecks(){
  const ul = $('seoChecks'); if(!ul) return;
  const kp = $('f_focus_keyphrase').value.trim().toLowerCase();
  if(!kp){ ul.innerHTML = '<li class="muted" style="padding:3px 0">Set a focus keyphrase to see SEO checks.</li>'; return; }
  const title = ($('f_seo_title').value.trim()||$('f_title').value.trim()).toLowerCase();
  const slug = $('f_slug').value.trim().toLowerCase();
  const meta = $('f_meta_description').value.trim().toLowerCase();
  const html = editor ? editor.getHTML() : '';
  const body = plainText(html).toLowerCase();
  const words = body ? body.split(/\s+/).filter(Boolean) : [];
  const firstPara = plainText((html.match(/<p[^>]*>[\s\S]*?<\/p>/i)||[''])[0]).toLowerCase();
  const headings = (html.match(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/gi)||[]).map(h=>plainText(h).toLowerCase());
  const imgs = html.match(/<img\b[^>]*>/gi)||[];
  const imgsNoAlt = imgs.filter(t=>!/\balt\s*=\s*["'][^"']+["']/i.test(t));
  const links = (html.match(/<a\b[^>]*href=/gi)||[]).length;
  const kpEsc = kp.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const occ = body ? (body.match(new RegExp(kpEsc,'g'))||[]).length : 0;
  const density = words.length ? occ*kp.split(/\s+/).length/words.length*100 : 0;
  const slugKp = kp.replace(/\s+/g,'-');

  const C = [];
  const good=(m)=>C.push({s:'good',m}), warn=(m)=>C.push({s:'warn',m}), bad=(m)=>C.push({s:'bad',m});
  (title.includes(kp)?good:bad)('Keyphrase in SEO title');
  (slug.includes(slugKp)?good:bad)('Keyphrase in URL slug');
  (meta.includes(kp)?good:bad)('Keyphrase in meta description');
  (firstPara.includes(kp)?good:warn)('Keyphrase in the first paragraph');
  (headings.some(h=>h.includes(kp))?good:warn)('Keyphrase in a subheading (H2/H3)');
  if(occ===0) bad('Keyphrase not used in the body');
  else if(density<0.5) warn('Keyphrase density '+density.toFixed(1)+'% — a little low ('+occ+'×)');
  else if(density>2.5) warn('Keyphrase density '+density.toFixed(1)+'% — possibly too high ('+occ+'×)');
  else good('Keyphrase density '+density.toFixed(1)+'% ('+occ+'×)');
  (words.length>=300?good:warn)('Content length: '+words.length+' words'+(words.length<300?' — aim for 300+':''));
  (links>0?good:warn)(links+' link'+(links===1?'':'s')+' in the body');
  if(imgs.length===0) warn('No images in the body');
  else (imgsNoAlt.length===0?good:bad)((imgs.length-imgsNoAlt.length)+'/'+imgs.length+' body images have alt text');

  const ng = C.filter(c=>c.s==='good').length;
  const dot = s=>s==='good'?'#1a7f37':s==='warn'?'#b9770e':'#b42318';
  ul.innerHTML = '<li style="padding:3px 0;font-weight:600">'+ng+'/'+C.length+' checks passing</li>' +
    C.map(c=>'<li style="display:flex;gap:8px;align-items:flex-start;padding:3px 0"><span style="flex:0 0 auto;width:9px;height:9px;border-radius:50%;margin-top:5px;background:'+dot(c.s)+'"></span><span>'+esc(c.m)+'</span></li>').join('');
}
// Sidebar nav + collapse + dashboard

// --- BEGIN GENERATED COVERAGE (scripts/update-coverage.mjs — do not edit by hand) ---
const COVERAGE = {
  stats: [['265','Tests'],['260','Passed'],['5','Env-gated skips'],['29','Suites'],['75.3%','Lines, instrumented'],['2','Files not exercised']],
  files: [
    { g:'Public API (serverless)' },
    { f:'api/blog-index.js', l:100, b:80, fn:87.5, n:'render-handlers' },
    { f:'api/contact.js', l:100, b:95, fn:100, n:'contact-api' },
    { f:'api/download.js', l:97.4, b:84.6, fn:50, n:'download-api' },
    { f:'api/feed.js', l:100, b:93.8, fn:100, n:'parity-surfaces' },
    { f:'api/linkedin.js', l:100, b:77.8, fn:100, n:'linkedin-api' },
    { f:'api/render-category.js', l:100, b:59.1, fn:85.7, n:'render-handlers' },
    { f:'api/render-post.js', l:100, b:81, fn:100, n:'render-handlers' },
    { f:'api/sitemap.js', l:100, b:85.7, fn:100, n:'route checked textually in parity tests only' },
    { f:'api/subscribe.js', l:100, b:100, fn:50, n:'subscribe-api' },
    { g:'Admin API (auth-gated)' },
    { f:'api/admin/fetch-meta.js', l:54.3, b:100, fn:40, n:'fetch-meta · extraction only, handler unexercised' },
    { f:'api/admin/linkedin.js', l:85, b:75.5, fn:100, n:'' },
    { f:'api/admin/login.js', l:100, b:83.3, fn:100, n:'' },
    { f:'api/admin/media.js', l:96.3, b:61.5, fn:100, n:'' },
    { f:'api/admin/posts.js', l:97.3, b:81, fn:100, n:'admin-posts-api' },
    { f:'api/admin/session.js', l:100, b:100, fn:100, n:'' },
    { f:'api/admin/set-password.js', l:100, b:84.6, fn:100, n:'' },
    { f:'api/admin/upload.js', l:100, b:55, fn:100, n:'' },
    { f:'api/admin/users.js', l:93.1, b:79.2, fn:100, n:'' },
    { g:'Shared helpers' },
    { f:'api/_auth.js', l:100, b:94.6, fn:100, n:'admin-posts-api' },
    { f:'api/_blog-data.js', l:100, b:93.8, fn:94.4, n:'render-handlers' },
    { f:'api/_blog-index-template.js', l:100, b:100, fn:100, n:'via blog-index' },
    { f:'api/_body.js', l:100, b:100, fn:100, n:'read-body' },
    { f:'api/_media.js', l:100, b:87, fn:100, n:'media-library listing glue' },
    { f:'api/_newsletter-mirror.js', l:93.8, b:81.3, fn:50, n:'' },
    { f:'api/_post-template.js', l:93.2, b:53.3, fn:83.3, n:'post-template, parity-surfaces' },
    { f:'api/_turnstile.js', l:100, b:100, fn:100, n:'turnstile' },
    { g:'Front-end' },
    { f:'common.js', l:64.7, b:89.1, fn:79.7, n:'linkedin-widget, download-modal, forms · reveal/counters/lightbox untested (visual)' },
    { f:'chrome.js', l:100, b:92.3, fn:100, n:'chrome · nav/footer injection smoke' },
    { f:'assets/cookie-consent.js', l:100, b:81.9, fn:96.4, n:'cookie-consent (helpers), cookie-consent-dom (banner/panel)' },
    { f:'admin/admin.js', l:31.2, b:78.5, fn:33, n:'admin-editor · picker/alt-bar/helpers; view flows untested' },
    { g:'Scripts' },
    { f:'scripts/sync-linkedin-fallback.mjs', none:true, n:'LinkedIn fallback-card generator' },
    { f:'scripts/update-coverage.mjs', none:true, n:'this generator (tooling)' },
  ],
};
// --- END GENERATED COVERAGE ---
let covRendered=false;
function renderCoverage(){
  if(covRendered) return; covRendered=true;
  $('covGlance').innerHTML = COVERAGE.stats.map(s=>'<div class="stat"><div class="n">'+s[0]+'</div><div class="l">'+s[1]+'</div></div>').join('');
  const band=v=>v>=90?'b-good':v>=70?'b-warn':v>=40?'b-serious':'b-critical';
  const fmt=v=>(Math.round(v*10)/10)+'%';
  const tb=$('covTable').querySelector('tbody');
  COVERAGE.files.forEach(r=>{
    const tr=document.createElement('tr');
    if(r.g){ tr.innerHTML='<td class="grp" colspan="5">'+r.g+'</td>'; tb.appendChild(tr); return; }
    let cells;
    if(r.none) cells='<td class="num b-none" colspan="3" title="Never imported by any test — no unit coverage">not exercised</td>';
    else if(r.partial) cells='<td class="num b-none" colspan="3" title="Inline script: not instrumentable; newest features tested via extraction">not instrumentable</td>';
    else cells=['l','b','fn'].map(k=>'<td class="num '+band(r[k])+'">'+fmt(r[k])+'</td>').join('');
    tr.innerHTML='<td class="file">'+esc(r.f)+'</td>'+cells+'<td class="note">'+(r.n||'&mdash;')+'</td>';
    tb.appendChild(tr);
  });
}
function showCoverage(){ hideViews(); $('coverageView').classList.remove('hide'); setActiveMenu('navCoverage'); renderCoverage(); }
// Media Library view
// drag-and-drop upload onto the library
function embedVideo(){ const url=$('tt-videourl').value.trim(); if(url && editor) editor.commands.setYoutubeVideo({ src:url }); $('tt-videobar').style.display='none'; $('tt-videourl').value=''; }

function collect(){
  return {
    slug:$('f_slug').value.trim(), title:$('f_title').value.trim(),
    seo_title:$('f_seo_title').value.trim()||null, meta_description:$('f_meta_description').value.trim()||null,
    excerpt:$('f_excerpt').value.trim()||null, body_html:(editor ? editor.getHTML() : ''),
    featured_image:$('f_featured_image').value.trim()||null, featured_image_alt:$('f_featured_image_alt').value.trim()||null,
    author:$('f_author').value.trim()||'Raj Goodman Anand', canonical_url:$('f_canonical_url').value.trim()||null,
    robots:$('f_robots').value.trim()||DEFAULT_ROBOTS, focus_keyphrase:$('f_focus_keyphrase').value.trim()||null,
    categories:Array.from(CAT_SEL),
    og_title:$('f_og_title').value.trim()||null, og_description:$('f_og_description').value.trim()||null, og_image:$('f_og_image').value.trim()||null,
  };
}
async function save(status){
  const f = collect();
  if(!f.title || !f.slug){ toast('Title and slug are required'); return; }
  f.status = status;
  let r;
  if (current && current.id) { f.id = current.id; r = await api('/api/admin/posts/', { method:'PATCH', body:JSON.stringify(f) }); }
  else { r = await api('/api/admin/posts/', { method:'POST', body:JSON.stringify(f) }); }
  if (r.ok) { current = r.body.post; fill(current); toast(status==='published'?'Published':'Saved'); }
  else { toast('Error: '+((r.body&&r.body.error)||r.status)); }
}


// ---- DOM wiring + boot (moved verbatim from the old top level; function
// declarations hoist, so registration order and behavior are unchanged) ----
function wireAdmin() {
$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await api('/api/admin/login/', { method:'POST', body: JSON.stringify({ email: $('email').value.trim(), password: $('pw').value }) });
  if (r.ok && r.body && r.body.ok) { $('loginErr').classList.add('hide'); ME = r.body; showApp(); }
  else { $('loginErr').classList.remove('hide'); }
});
$('setpwForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('setpwErr'); err.classList.add('hide');
  const pw = $('newpw').value;
  if (pw.length < 8) { err.textContent='Password must be at least 8 characters.'; err.classList.remove('hide'); return; }
  const r = await api('/api/admin/set-password/', { method:'POST', body: JSON.stringify({ ...INVITE, password: pw }) });
  if (r.ok && r.body && r.body.ok) {
    const s = await api('/api/admin/session/');
    if (s.status === 200 && s.body && s.body.ok) { ME = s.body; showApp(); }
    else { $('setpw').classList.add('hide'); $('login').classList.remove('hide'); }
  } else { err.textContent = 'Could not set password — the link may have expired. Ask an admin for a fresh invite or password reset.'; err.classList.remove('hide'); }
});
$('logoutBtn').addEventListener('click', async (e) => { e.preventDefault(); await api('/api/admin/session/', { method:'DELETE' }); location.reload(); });
$('usersBtn').addEventListener('click', showUsers);
$('usersBackBtn').addEventListener('click', loadList);
$('inviteForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('inviteMsg'); msg.classList.add('hide');
  const email = $('inv_email').value.trim();
  if (!email) return;
  const r = await api('/api/admin/users/', { method:'POST', body: JSON.stringify({ email, role: $('inv_role').value }) });
  if (r.ok && r.body && r.body.ok) {
    hideRateLimitNotice();
    msg.textContent = `Invite sent to ${email}.`; msg.style.color=''; msg.classList.remove('hide');
    $('inv_email').value=''; showUsers();
  } else if (r.status === 429 && r.body && r.body.error === 'rate-limited') {
    showRateLimitNotice(r.body.retryAfterSeconds);
    msg.textContent = 'Not sent — the email rate limit is in effect. The form is kept filled; try again in ' + rateLimitWait(r.body.retryAfterSeconds) + '.';
    msg.style.color='#b42318'; msg.classList.remove('hide');
  } else {
    msg.textContent = 'Invite failed' + (r.body && r.body.detail ? ': ' + r.body.detail : '.'); msg.style.color='#b42318'; msg.classList.remove('hide');
  }
});
$('f_title').addEventListener('input', ()=>{ if(!slugEdited){ $('f_slug').value=slugify($('f_title').value); } refreshMeta(); });
$('f_slug').addEventListener('input', ()=>{ slugEdited=true; $('f_slug').value=slugify($('f_slug').value); refreshMeta(); });
['f_seo_title','f_meta_description','f_excerpt','f_featured_image','f_canonical_url','f_og_title','f_og_description','f_og_image'].forEach(id=>$(id).addEventListener('input',refreshMeta));
$('f_focus_keyphrase').addEventListener('input', runSeoChecks);
$('f_noindex').addEventListener('change', ()=>{ $('f_robots').value = $('f_noindex').checked ? 'noindex, follow' : DEFAULT_ROBOTS; });
$('f_robots').addEventListener('input', ()=>{ $('f_noindex').checked = /noindex/i.test($('f_robots').value); });
$('fiUpload').addEventListener('click', ()=> pickFile(async (f)=>{ toast('Uploading…'); try{ const url=await uploadFile(f); $('f_featured_image').value=url; refreshMeta(); MEDIA_LOADED=false; toast('Uploaded'); }catch(e){ toast('Upload failed'); } }));
$('fiLibrary').addEventListener('click', ()=> openMedia((url,f)=>{ $('f_featured_image').value=url; if(f&&f.alt&&!$('f_featured_image_alt').value) $('f_featured_image_alt').value=f.alt; refreshMeta(); }));
$('mediaClose').addEventListener('click', closeMedia);
$('mediaModal').addEventListener('click', (e)=>{ if(e.target===$('mediaModal')) closeMedia(); });
$('mediaModalUpload').addEventListener('click', ()=> pickFile(async (f)=>{ toast('Uploading…'); try{ await uploadFile(f); MEDIA_LOADED=false; toast('Uploaded'); loadMedia(); }catch(e){ toast('Upload failed'); } }));
$('navDashboard').addEventListener('click', showDashboard);
$('navPosts').addEventListener('click', loadList);
$('navLinkedin').addEventListener('click', showLinkedin);
$('navCoverage').addEventListener('click', showCoverage);
$('dashNew').addEventListener('click', ()=>openEditor(null));
$('dashMedia').addEventListener('click', showMedia);
$('liAddBtn').addEventListener('click', ()=>liOpenForm(null));
$('liCancel').addEventListener('click', liCloseForm);
$('liFetch').addEventListener('click', liFetchMeta);
$('liSave').addEventListener('click', liSave);
$('li_image').addEventListener('input', liPreview);
$('liUpload').addEventListener('click', ()=> pickFile(async (f)=>{ toast('Uploading…'); try{ const url=await uploadFile(f); $('li_image').value=url; liPreview(); MEDIA_LOADED=false; toast('Uploaded'); }catch(e){ toast('Upload failed'); } }));
$('liLibrary').addEventListener('click', ()=> openMedia((url)=>{ $('li_image').value=url; liPreview(); }));
$('collapseBtn').addEventListener('click', ()=>{ const f=$('app').classList.toggle('folded'); try{ localStorage.setItem('wpfold', f?'1':''); }catch(e){} });
$('mediaBtn').addEventListener('click', showMedia);
$('mediaBackBtn').addEventListener('click', loadList);
$('mediaSearch').addEventListener('input', renderMediaLibrary);
$('mediaUploadBtn').addEventListener('click', ()=> pickFile(async (f)=>{ toast('Uploading…'); try{ await uploadFile(f); MEDIA_LOADED=false; toast('Uploaded'); loadMediaLibrary(); }catch(e){ toast('Upload failed'); } }));
const _mediaDrop=$('mediaDrop');
['dragover','dragenter'].forEach(ev=>_mediaDrop.addEventListener(ev,e=>{ e.preventDefault(); _mediaDrop.classList.add('drag'); }));
_mediaDrop.addEventListener('dragleave',e=>{ if(!_mediaDrop.contains(e.relatedTarget)) _mediaDrop.classList.remove('drag'); });
_mediaDrop.addEventListener('drop', async e=>{
  e.preventDefault(); _mediaDrop.classList.remove('drag');
  const files=[...((e.dataTransfer&&e.dataTransfer.files)||[])].filter(f=>/^image\//.test(f.type));
  if(!files.length) return;
  toast('Uploading '+files.length+' file'+(files.length>1?'s':'')+'…');
  let failed=0;
  for(const f of files){ try{ await uploadFile(f); }catch(err){ failed++; } }
  MEDIA_LOADED=false;
  toast(failed ? (files.length-failed)+' uploaded, '+failed+' failed' : 'Uploaded');
  loadMediaLibrary();
});
$('tt-toolbar').addEventListener('click', e=>{ const b=e.target.closest('button[data-cmd]'); if(b) ttCmd(b.getAttribute('data-cmd')); });
$('tt-videoembed').addEventListener('click', embedVideo);
$('tt-videocancel').addEventListener('click', ()=>{ $('tt-videobar').style.display='none'; $('tt-videourl').value=''; });
$('tt-altapply').addEventListener('click', applyImageAlt);
$('tt-altinput').addEventListener('keydown', e=>{
  if(e.key==='Enter'){ e.preventDefault(); applyImageAlt(); if(editor) editor.chain().focus().run(); }
  else if(e.key==='Escape'){ e.preventDefault(); if(editor) editor.chain().focus().run(); }
});
// The bar is positioned against the image's viewport rect, so it has to follow
// the image when anything scrolls or the window resizes. Capture phase catches
// scrolling inside the editor pane as well as the page.
['scroll','resize'].forEach(ev=>window.addEventListener(ev, ()=>{
  if(editor && editor.isActive && editor.isActive('image')) positionAltBar();
}, true));
$('tt-ctabar').addEventListener('click', e=>{ const p=e.target.closest('.cta-preset'); if(p) insertCTA(p.dataset.h,p.dataset.t,p.dataset.l,p.dataset.u); });
$('cta-insert').addEventListener('click', ()=> insertCTA($('cta-h').value.trim(),$('cta-t').value.trim(),$('cta-l').value.trim(),$('cta-u').value.trim()));
$('cta-cancel').addEventListener('click', ()=>{ $('tt-ctabar').style.display='none'; });
$('tt-formbar').addEventListener('click', e=>{ const p=e.target.closest('.form-preset'); if(p) insertForm(p.dataset.kind); });
$('form-cancel').addEventListener('click', ()=>{ $('tt-formbar').style.display='none'; });
$('tt-videourl').addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); embedVideo(); } });
$('f_catbox').addEventListener('change', e=>{ const cb=e.target.closest('input[data-cat]'); if(!cb) return; const c=cb.getAttribute('data-cat'); if(cb.checked) CAT_SEL.add(c); else CAT_SEL.delete(c); });
$('f_cataddbtn').addEventListener('click', addNewCat);
$('f_catnew').addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); addNewCat(); } });
$('newBtn').addEventListener('click', ()=>openEditor(null));
$('backBtn').addEventListener('click', loadList);
$('saveBtn').addEventListener('click', ()=>save(current && current.status==='published' ? 'published' : 'draft'));
$('publishBtn').addEventListener('click', ()=>save('published'));
$('unpubBtn').addEventListener('click', ()=>save('draft'));
$('previewBtn').addEventListener('click', ()=>{ const s=$('f_slug').value.trim(); if(s) window.open('/blog/'+s+'/','_blank'); });
$('deleteBtn').addEventListener('click', async ()=>{
  if(!current||!current.id) return;
  if(!confirm('Delete this post permanently?')) return;
  const r = await api('/api/admin/posts/', { method:'DELETE', body:JSON.stringify({id:current.id}) });
  if(r.ok){ toast('Deleted'); loadList(); } else { toast('Delete failed'); }
});
boot();
}
if (typeof document !== 'undefined') wireAdmin();

/* Exposed for unit tests under Node (CommonJS); a no-op in the browser. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    slugify, esc, parseHash, collect, renderCats, addNewCat,
    applyImageAlt, updateToolbarActive, renderCoverage, wireAdmin, COVERAGE,
    api, loadFailMsg, fetchMedia, compressImage, showRateLimitNotice, rateLimitWait, sendReset,
    __test: {
      setEditor: (e) => { editor = e; },
      setCats: (all, sel) => { CAT_ALL = all; CAT_SEL = new Set(sel); },
      getCats: () => ({ all: CAT_ALL, sel: CAT_SEL }),
      setCurrent: (c) => { current = c; },
    },
  };
}
