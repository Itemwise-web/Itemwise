/* Itemwise website layer: sign-in, sync storage and receipt reading, using the same
   window.claude.use('user'|'db'|'sample') calls the app already makes. */
(function () {
  if (window.claude && window.claude.use) return;           // inside Claude: nothing to do
  const cfg = window.ITEMWISE_CONFIG || {};
  const MEDIA = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let sb = null, session = null, resolveReady; const ready = new Promise(r => (resolveReady = r));

  function overlay(html) {
    let o = document.getElementById('iw-auth');
    if (!o) {
      o = document.createElement('div'); o.id = 'iw-auth';
      o.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#0f1419;color:#e8ecf1;display:flex;align-items:center;justify-content:center;padding:24px;font-family:Inter,system-ui,sans-serif;overflow:auto';
      document.body.appendChild(o);
    }
    o.innerHTML = '<div style="width:100%;max-width:340px">' + html + '</div>'; return o;
  }
  const inp = 'width:100%;box-sizing:border-box;padding:12px;margin:6px 0;border-radius:8px;border:1px solid #3a4452;background:#1a212b;color:#e8ecf1;font-size:16px';
  const btn = 'width:100%;padding:12px;margin:8px 0;border-radius:8px;border:0;background:#4f8cff;color:#fff;font-size:16px;font-weight:600;cursor:pointer';
  const link = 'background:none;border:0;color:#8fb4ff;cursor:pointer;font-size:14px;padding:6px 0;text-decoration:underline';

  function showAuth(mode, msg) {
    const sign = mode === 'in';
    const o = overlay(
      '<h1 style="font-size:24px;margin:0 0 4px">Itemwise</h1>' +
      '<p style="margin:0 0 14px;color:#9aa6b5">' + (sign ? 'Sign in to your budget.' : 'Create your account.') + '</p>' +
      (msg ? '<p role="status" style="background:#26303d;padding:10px;border-radius:8px">' + esc(msg) + '</p>' : '') +
      '<input id="iw-em" type="email" autocomplete="email" placeholder="Email" style="' + inp + '">' +
      '<input id="iw-pw" type="password" autocomplete="' + (sign ? 'current-password' : 'new-password') + '" placeholder="Password' + (sign ? '' : ' (at least 10 characters)') + '" style="' + inp + '">' +
      '<button id="iw-go" style="' + btn + '">' + (sign ? 'Sign in' : 'Create account') + '</button>' +
      '<div><button id="iw-sw" style="' + link + '">' + (sign ? 'New here? Create an account' : 'Have an account? Sign in') + '</button></div>' +
      (sign ? '<div><button id="iw-fp" style="' + link + '">Forgot password</button></div>' : ''));
    const em = o.querySelector('#iw-em'), pw = o.querySelector('#iw-pw');
    const go = async () => {
      const email = em.value.trim(), password = pw.value;
      if (!email || !password) return showAuth(mode, 'Enter your email and password.');
      if (!sign && password.length < 10) return showAuth(mode, 'Use at least 10 characters for your password.');
      o.querySelector('#iw-go').disabled = true;
      const r = sign ? await sb.auth.signInWithPassword({ email, password }) : await sb.auth.signUp({ email, password });
      if (r.error) return showAuth(mode, sign ? 'That email and password did not match.' : r.error.message);
      if (!sign && !r.data.session) return showAuth('in', 'Account created. Check your email to confirm it, then sign in.');
    };
    o.querySelector('#iw-go').onclick = go;
    pw.onkeydown = e => { if (e.key === 'Enter') go(); };
    o.querySelector('#iw-sw').onclick = () => showAuth(sign ? 'up' : 'in');
    const fp = o.querySelector('#iw-fp');
    if (fp) fp.onclick = async () => {
      const email = em.value.trim(); if (!email) return showAuth('in', 'Type your email first, then tap Forgot password.');
      await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      showAuth('in', 'If that email has an account, a reset link is on its way.');
    };
  }

  function showReset() {
    const o = overlay('<h1 style="font-size:22px;margin:0 0 10px">Choose a new password</h1>' +
      '<input id="iw-np" type="password" autocomplete="new-password" placeholder="New password (10+ characters)" style="' + inp + '">' +
      '<button id="iw-sv" style="' + btn + '">Save password</button>');
    o.querySelector('#iw-sv').onclick = async () => {
      const p = o.querySelector('#iw-np').value;
      if (p.length < 10) return;
      const r = await sb.auth.updateUser({ password: p });
      if (r.error) return showAuth('in', r.error.message);
      done(session);
    };
  }

  function chip() {
    if (document.getElementById('iw-chip') || !session) return;
    const d = document.createElement('div'); d.id = 'iw-chip';
    d.style.cssText = 'text-align:center;font-size:12px;color:#8a95a5;padding:18px 12px calc(18px + env(safe-area-inset-bottom,0px))';
    d.innerHTML = esc(session.user.email || '') + ' · <button id="iw-how" style="' + link + ';font-size:12px">How it works</button> · <button id="iw-out" style="' + link + ';font-size:12px">Sign out</button>';
    d.querySelector('#iw-how').onclick = () => walkthrough(true);
    d.querySelector('#iw-out').onclick = async () => {
      if (!confirm('Sign out? Anything not yet synced on this device will be removed from it.')) return;
      await sb.auth.signOut();
      try { Object.keys(localStorage).filter(k => k.indexOf('itemwise.') === 0).forEach(k => localStorage.removeItem(k)); } catch (e) {}
      location.reload();
    };
    document.body.appendChild(d);
  }


  /* ---- first-run walkthrough: a short bottom sheet that opens each tab in turn ---- */
  const STEPS = [
    { tab: 'budgets', t: 'Budgets: start here', b: 'Tap “Show income lines” and add what you earn, then give each category a planned amount. When income minus plans is $0, every dollar has a job.' },
    { tab: 'import', t: 'Import: bring in charges', b: 'Download a CSV from your bank’s website and add it here. Importing the same file twice adds nothing.' },
    { tab: 'review', t: 'Review: decide what’s unclear', b: 'Charges at stores like Walmart or Target can be split by item or filed under one category. Confirm any guessed categories here too.' },
    { tab: 'activity', t: 'Activity and Rules', b: 'Activity lists every charge, so you can fix a category any time. Rules (under More) remember each store so the next charge files itself.' },
    { tab: 'data', t: 'Data: keep a backup', b: 'Your budget is saved to your account, so phone and computer match. It isn’t end-to-end encrypted, so the site owner could technically read it. Tap Copy backup now and then. On iPhone, use Share, then Add to Home Screen.' }
  ];
  function walkthrough(force) {
    const key = 'iw.welcome.' + (session && session.user.id);
    try { if (!force && localStorage.getItem(key)) return; } catch (e) {}
    let i = 0;
    const sheet = document.createElement('div'); sheet.id = 'iw-walk'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', 'Welcome walkthrough');
    sheet.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#1a212b;color:#e8ecf1;border-top:1px solid #3a4452;padding:16px 18px calc(16px + env(safe-area-inset-bottom,0px));font-family:Inter,system-ui,sans-serif;box-shadow:0 -8px 24px rgba(0,0,0,.4)';
    const close = () => { try { localStorage.setItem(key, '1'); } catch (e) {} sheet.remove(); };
    const draw = () => {
      const s = STEPS[i], last = i === STEPS.length - 1;
      if (location.hash !== '#' + s.tab) location.hash = s.tab;
      sheet.innerHTML = '<div style="max-width:560px;margin:auto"><div style="font-size:12px;color:#9aa6b5">' + (i + 1) + ' of ' + STEPS.length + '</div>' +
        '<div style="font-size:17px;font-weight:600;margin:2px 0 6px">' + esc(s.t) + '</div><div style="font-size:15px;line-height:1.45;color:#cfd7e2">' + esc(s.b) + '</div>' +
        '<div style="display:flex;gap:8px;align-items:center;margin-top:12px"><button id="iw-wk" style="' + link + ';margin-right:auto">Skip</button>' +
        (i ? '<button id="iw-wb" style="padding:10px 14px;border-radius:8px;border:1px solid #3a4452;background:none;color:#e8ecf1;font-size:15px;cursor:pointer">Back</button>' : '') +
        '<button id="iw-wn" style="padding:10px 18px;border-radius:8px;border:0;background:#4f8cff;color:#fff;font-size:15px;font-weight:600;cursor:pointer">' + (last ? 'Done' : 'Next') + '</button></div></div>';
      sheet.querySelector('#iw-wk').onclick = close;
      sheet.querySelector('#iw-wn').onclick = () => { if (last) { close(); location.hash = 'budgets'; } else { i++; draw(); } };
      const b = sheet.querySelector('#iw-wb'); if (b) b.onclick = () => { i--; draw(); };
    };
    const old = document.getElementById('iw-walk'); if (old) old.remove();
    document.body.appendChild(sheet); draw();
  }

  function done(s) { session = s; const o = document.getElementById('iw-auth'); if (o) o.remove(); chip(); resolveReady(s); setTimeout(() => walkthrough(false), 600); }

  function codeErr(code) { const e = new Error(code); e.code = code; return e; }

  /* ---- db: the app stores small chunks under one collection; we keep them in user_data ---- */
  function makeDb() {
    return {
      doc(path) {
        return { collection(name) {
          const scope = path + '/' + name;
          return {
            doc(id) { return { async set(v) {
              const r = await sb.rpc('put_doc', { p_scope: scope, p_doc: id, p_j: v.j, p_t: v.t });
              if (r.error) throw codeErr(/size|too large/i.test(r.error.message) ? 'quota_exceeded' : 'unavailable');
            } }; },
            onSnapshot(cb, errCb) {
              let stopped = false, busy = false, again = false, timer = null;
              const pull = async () => {
                if (stopped) return; if (busy) { again = true; return; } busy = true;
                try {
                  const r = await sb.from('user_data').select('doc_id,j,t').eq('scope', scope);
                  if (r.error) throw r.error;
                  cb({ docs: (r.data || []).map(x => ({ id: x.doc_id, data: () => ({ j: x.j, t: +x.t }) })) });
                } catch (e) { if (errCb) errCb({ code: 'unavailable' }); }
                busy = false; if (again) { again = false; pull(); }
              };
              const ch = sb.channel('iw-' + scope).on('postgres_changes', { event: '*', schema: 'public', table: 'user_data' }, () => {
                clearTimeout(timer); timer = setTimeout(pull, 400);
              }).subscribe();
              const poll = setInterval(pull, 30000);
              document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pull(); });
              pull();
              return () => { stopped = true; clearInterval(poll); try { sb.removeChannel(ch); } catch (e) {} };
            }
          };
        } };
      }
    };
  }

  /* ---- sample: receipt photo -> text, through our own server function ---- */
  async function shrink(file) {
    let bmp; try { bmp = await createImageBitmap(file); } catch (e) { throw codeErr('image_rejected'); }
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    if (!blob) throw codeErr('image_rejected');
    return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = () => rej(codeErr('image_rejected')); fr.readAsDataURL(blob); });
  }
  function parseJson(t) {
    const x = String(t || '').replace(/```json|```/g, '').trim(); if (!x) throw codeErr('empty_completion');
    const a = x.indexOf('{'), b = x.lastIndexOf('}');
    try { return JSON.parse(x.slice(a, b + 1)); } catch (e) { throw codeErr('invalid_json'); }
  }
  function makeSample() {
    const fn = async () => { throw codeErr('images_unavailable'); };
    fn.limits = async () => ({ images: { mediaTypes: MEDIA } });
    fn.json = async (prompt, opts) => {
      opts = opts || {}; const file = opts.images && opts.images[0]; if (!file) throw codeErr('images_unavailable');
      const data = await shrink(file);
      let r;
      try {
        r = await fetch(cfg.SUPABASE_URL + '/functions/v1/read-receipt', {
          method: 'POST', signal: opts.signal,
          headers: { 'content-type': 'application/json', apikey: cfg.SUPABASE_ANON_KEY, authorization: 'Bearer ' + (session && session.access_token) },
          body: JSON.stringify({ prompt, image: { media_type: 'image/jpeg', data } })
        });
      } catch (e) { throw codeErr(e && e.name === 'AbortError' ? 'cancelled' : 'upstream_error'); }
      let body = {}; try { body = await r.json(); } catch (e) {}
      if (!r.ok) throw codeErr(body.code || 'upstream_error');
      return parseJson(body.text);
    };
    return fn;
  }

  const NS = { user: { id: async () => session && session.user.id }, db: null, sample: null };
  window.claude = { use: async name => { await ready; if (name === 'db') return NS.db || (NS.db = makeDb()); if (name === 'sample') return NS.sample || (NS.sample = makeSample()); return NS[name] || null; } };

  function start() {
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || !window.supabase) {
      overlay('<h1 style="font-size:22px">Itemwise is not set up yet</h1><p style="color:#9aa6b5">Add your Supabase address and key to config.js (see README step 5).</p>'); return;
    }
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    let recovering = false;
    sb.auth.onAuthStateChange((ev, s) => {
      if (ev === 'PASSWORD_RECOVERY') { recovering = true; session = s; showReset(); return; }
      if (ev === 'SIGNED_IN' && s && !recovering) done(s);
      if (ev === 'TOKEN_REFRESHED' && s) session = s;
      if (ev === 'SIGNED_OUT') { session = null; }
    });
    sb.auth.getSession().then(r => { const s = r.data && r.data.session; if (s && !recovering) done(s); else if (!recovering) showAuth('in'); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
