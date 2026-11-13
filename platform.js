/* Itemwise website layer: sign-in, sync storage and receipt reading, using the same
   window.claude.use('user'|'db'|'sample') calls the app already makes. */
(function () {
  if (window.claude && window.claude.use) return;           // inside Claude: nothing to do
  const cfg = window.ITEMWISE_CONFIG || {};
  const MEDIA = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let sb = null, session = null, resolveReady, hh = { role: 'none', unavailable: true }, dataUid = null; const ready = new Promise(r => (resolveReady = r));

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

  const here = () => location.origin + location.pathname;
  function showAuth(mode, msg, resendFor) {
    const sign = mode === 'in';
    const o = overlay(
      '<h1 style="font-size:24px;margin:0 0 4px">Itemwise</h1>' +
      '<p style="margin:0 0 14px;color:#9aa6b5">' + (sign ? 'Sign in to your budget.' : 'Create your account.') + '</p>' +
      (msg ? '<p role="status" style="background:#26303d;padding:10px;border-radius:8px">' + esc(msg) + '</p>' : '') +
      '<input id="iw-em" type="email" autocomplete="email" placeholder="Email" style="' + inp + '">' +
      '<input id="iw-pw" type="password" autocomplete="' + (sign ? 'current-password' : 'new-password') + '" placeholder="Password' + (sign ? '' : ' (at least 10 characters)') + '" style="' + inp + '">' +
      '<button id="iw-go" style="' + btn + '">' + (sign ? 'Sign in' : 'Create account') + '</button>' +
      '<div><button id="iw-sw" style="' + link + '">' + (sign ? 'New here? Create an account' : 'Have an account? Sign in') + '</button></div>' +
      (resendFor ? '<div><button id="iw-rs" style="' + btn + '">Resend confirmation email</button></div>' : '') +
      (sign ? '<div><button id="iw-fp" style="' + link + '">Forgot password</button></div>' : ''));
    const em = o.querySelector('#iw-em'), pw = o.querySelector('#iw-pw');
    const go = async () => {
      const email = em.value.trim(), password = pw.value;
      if (!email || !password) return showAuth(mode, 'Enter your email and password.');
      if (!sign && password.length < 10) return showAuth(mode, 'Use at least 10 characters for your password.');
      o.querySelector('#iw-go').disabled = true;
      const r = sign ? await sb.auth.signInWithPassword({ email, password }) : await sb.auth.signUp({ email, password, options: { emailRedirectTo: here() } });
      if (r.error) {
        if (sign && (r.error.code === 'email_not_confirmed' || /not confirmed/i.test(r.error.message || ''))) return showAuth('in', 'Your email is not confirmed yet. Use the newest email from us, or send a new one.', email);
        return showAuth(mode, sign ? 'That email and password did not match.' : r.error.message);
      }
      if (!sign && !r.data.session) return showAuth('in', 'Account created. Check your email to confirm it, then sign in.');
    };
    o.querySelector('#iw-go').onclick = go;
    pw.onkeydown = e => { if (e.key === 'Enter') go(); };
    o.querySelector('#iw-sw').onclick = () => showAuth(sign ? 'up' : 'in');
    const rs = o.querySelector('#iw-rs');
    if (rs) rs.onclick = async () => {
      const r = await sb.auth.resend({ type: 'signup', email: resendFor, options: { emailRedirectTo: here() } });
      showAuth('in', r.error ? 'Could not send it just now. Wait a minute and try again.' : 'Sent. Open the newest email (check spam) and click its link.');
    };
    const fp = o.querySelector('#iw-fp');
    if (fp) fp.onclick = async () => {
      const email = em.value.trim(); if (!email) return showAuth('in', 'Type your email first, then tap Forgot password.');
      await sb.auth.resetPasswordForEmail(email, { redirectTo: here() });
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
    d.innerHTML = esc(session.user.email || '') + ' · <button id="iw-rf" style="' + link + ';font-size:12px">Refresh</button>' + (hh.unavailable ? '' : ' · <button id="iw-hhb" style="' + link + ';font-size:12px">' + (hh.role === 'member' ? 'Shared budget' : 'Household') + '</button>') + ' · <button id="iw-how" style="' + link + ';font-size:12px">How it works</button> · <button id="iw-out" style="' + link + ';font-size:12px">Sign out</button>';
    d.querySelector('#iw-how').onclick = () => walkthrough(true);
    d.querySelector('#iw-rf').onclick = refreshNow;
    const hb = d.querySelector('#iw-hhb'); if (hb) hb.onclick = () => showHousehold();
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
    { tab: 'overview', t: 'Overview: your whole picture', b: 'Add your bank, savings, investment and debt balances under Accounts (More on a phone). Then Overview shows net worth and money available. Tap Customize to choose and reorder what it shows.' },
    { tab: 'budgets', t: 'Budgets: start here', b: 'Tap “Show income lines” and add what you earn, then give each category a planned amount. When income minus plans is $0, every dollar has a job.' },
    { tab: 'import', t: 'Import: bring in charges', b: 'Download a CSV from your bank’s website and add it here. Importing the same file twice adds nothing.' },
    { tab: 'review', t: 'Review: decide what’s unclear', b: 'Charges at stores like Walmart or Target can be split by item or filed under one category. Confirm any guessed categories here too.' },
    { tab: 'activity', t: 'Activity and Rules', b: 'Activity lists every charge, so you can fix a category any time. Rules (under More) remember each store so the next charge files itself.' },
    { tab: 'data', t: 'Data: keep a backup', b: 'Your budget is saved to your account, so phone and computer match. It isn’t end-to-end encrypted, so the site owner could technically read it. Tap Copy backup now and then. On iPhone, use Share, then Add to Home Screen.' }
  ];
  let walkShown = false;
  function walkthrough(force) {
    const key = 'iw.welcome.' + (session && session.user.id);
    if (!force) {
      if (walkShown) return;
      if (session && session.user && session.user.user_metadata && session.user.user_metadata.welcomed) return;
      try { if (localStorage.getItem(key)) return; } catch (e) {}
      // Count it as seen as soon as it appears, here and on the account, so it never repeats.
      walkShown = true;
      try { localStorage.setItem(key, '1'); } catch (e) {}
      try { Promise.resolve(sb.auth.updateUser({ data: { welcomed: true } })).catch(() => {}); } catch (e) {}
    }
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

  /* ---- household: two accounts sharing one budget ---- */
  async function fetchHH() {
    try { const r = await sb.rpc('household_info'); if (r.error) throw r.error; return r.data || { role: 'none' }; }
    catch (e) { return { role: 'none', unavailable: true }; }
  }
  const budgetUid = (info, s) => (info.role === 'member' && info.owner_id) ? info.owner_id : s.user.id;
  function switchBudget() {
    try { Object.keys(localStorage).filter(k => k.indexOf('itemwise.') === 0).forEach(k => localStorage.removeItem(k)); } catch (e) {}
    location.reload();
  }
  function panel(html) {
    let o = document.getElementById('iw-hh');
    if (!o) {
      o = document.createElement('div'); o.id = 'iw-hh'; o.setAttribute('role', 'dialog'); o.setAttribute('aria-label', 'Household');
      o.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px;font-family:Inter,system-ui,sans-serif;overflow:auto';
      document.body.appendChild(o);
    }
    o.innerHTML = '<div style="width:100%;max-width:420px;background:#1a212b;color:#e8ecf1;border:1px solid #3a4452;border-radius:12px;padding:18px;box-sizing:border-box">' + html +
      '<div style="text-align:right;margin-top:10px"><button id="iw-hc" style="' + link + '">Close</button></div></div>';
    o.querySelector('#iw-hc').onclick = () => o.remove();
    return o;
  }
  const fmtCode = c => String(c || '').replace(/(.{4})(?=.)/g, '$1-');
  const joinMsg = code => 'Join my Itemwise budget: open ' + here() + ', sign in, tap Household at the bottom, choose Join, and enter this code: ' + fmtCode(code) + ' (good for 48 hours).';
  const JOIN_ERR = {
    invalid: 'That code is not valid or has expired. Ask for a new one.',
    already_member: 'You have already joined a household.',
    has_members: 'Other people are already using your budget. Remove them first if you want to join someone else.',
    self: 'That is your own code. Send it to the other person.'
  };
  async function showHousehold(note) {
    const info = await fetchHH();
    if (!info.unavailable && budgetUid(info, session) !== dataUid) { switchBudget(); return; }   // changed from another device
    hh = info;
    const box = 'border-top:1px solid #3a4452;margin-top:12px;padding-top:12px';
    let h = '<h2 style="font-size:20px;margin:0 0 6px">Household</h2>' + (note ? '<p role="status" style="background:#26303d;padding:10px;border-radius:8px">' + esc(note) + '</p>' : '');
    if (info.unavailable) {
      h += '<p style="color:#9aa6b5">Sharing is not available yet. The owner of this site needs to turn it on.</p>';
    } else if (info.role === 'member') {
      h += '<p style="color:#cfd7e2">You are sharing <b>' + esc(info.owner_email || 'another account') + '</b>’s budget. What you change here is saved to that budget, and they see it too.</p>' +
        '<div style="' + box + '"><button id="iw-leave" style="' + btn + ';background:#8a3a3a">Leave this household</button><p style="color:#9aa6b5;font-size:13px;margin:4px 0 0">You will go back to your own budget, which is unchanged.</p></div>';
    } else {
      h += '<p style="color:#cfd7e2">Share this budget with someone you trust, like your spouse. They sign in with their own account and see and edit the same budget.</p>';
      if ((info.members || []).length) {
        h += '<div style="' + box + '"><div style="color:#9aa6b5;font-size:13px">Sharing with</div>' + info.members.map(m => '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0"><span>' + esc(m.email || 'account') + '</span><button data-rm="' + esc(m.id) + '" style="' + link + '">Remove</button></div>').join('') + '</div>';
      }
      h += '<div style="' + box + '">';
      if (info.invite) {
        const hrs = Math.max(1, Math.round((new Date(info.invite.expires_at) - Date.now()) / 36e5));
        h += '<div style="color:#9aa6b5;font-size:13px">Invite code (good for about ' + hrs + ' more hours, one use)</div><div id="iw-code" style="font:600 24px/1.4 ui-monospace,monospace;letter-spacing:1px;margin:4px 0">' + esc(fmtCode(info.invite.code)) + '</div>' +
          '<button id="iw-copy" style="' + btn + '">Copy a message to send</button><button id="iw-new" style="' + link + '">Make a new code</button>';
      } else {
        h += '<button id="iw-new" style="' + btn + '">Create an invite code</button>';
      }
      h += '<p style="color:#9aa6b5;font-size:13px;margin:6px 0 0">Anyone who has the code can join within 48 hours and can change or delete everything in this budget. Give it only to the person you mean to. You can remove them any time.</p></div>';
      if (!(info.members || []).length) {
        h += '<div style="' + box + '"><div style="font-weight:600">Have a code from someone?</div><input id="iw-jc" placeholder="XXXX-XXXX-XXXX" autocapitalize="characters" autocomplete="off" style="' + inp + '"><button id="iw-join" style="' + btn + '">Join their budget</button>' +
          '<p style="color:#9aa6b5;font-size:13px;margin:4px 0 0">You will see their budget instead of your own. Your own budget stays in your account and comes back if you leave.</p></div>';
      }
    }
    const o = panel(h);
    const q = id => o.querySelector(id);
    const again = n => showHousehold(n);
    if (q('#iw-new')) q('#iw-new').onclick = async () => { const r = await sb.rpc('create_invite'); again(r.error ? 'Could not make a code just now. Try again.' : ''); };
    if (q('#iw-copy')) q('#iw-copy').onclick = async () => { try { await navigator.clipboard.writeText(joinMsg(info.invite.code)); q('#iw-copy').textContent = 'Copied. Paste it into a text or email.'; } catch (e) { q('#iw-copy').textContent = 'Could not copy. Select the code above instead.'; } };
    if (q('#iw-join')) q('#iw-join').onclick = async () => {
      const code = q('#iw-jc').value.trim(); if (!code) return again('Type the code first.');
      const r = await sb.rpc('accept_invite', { p_code: code });
      if (r.error || !r.data) return again('Could not join just now. Try again.');
      if (r.data.ok) return switchBudget();
      again(JOIN_ERR[r.data.code] || JOIN_ERR.invalid);
    };
    if (q('#iw-leave')) q('#iw-leave').onclick = async () => { if (!confirm('Leave this household? You will go back to your own budget.')) return; const r = await sb.rpc('leave_household'); if (r.error) return again('Could not leave just now. Try again.'); switchBudget(); };
    o.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => { if (!confirm('Remove this person from your budget? They keep their own account.')) return; const r = await sb.rpc('remove_member', { p_member: b.dataset.rm }); again(r.error ? 'Could not remove them just now.' : 'Removed.'); });
  }


  /* ---- settings: appearance, layout, refresh, account ---- */
  const DEFAULT_PREFS = { theme: 'auto', accent: 'blue', density: 'comfortable', size: 'normal', width: 'standard' };
  const ACCENTS = { blue: 'Blue', green: 'Green', purple: 'Purple', orange: 'Orange' };
  const PREF_CSS = `
:root[data-accent="green"]{--accent:#1B7A4B;--accent-soft:#DFF2E7}
:root[data-accent="purple"]{--accent:#6B46C1;--accent-soft:#EDE7FA}
:root[data-accent="orange"]{--accent:#B45309;--accent-soft:#FBEBD5}
@media (prefers-color-scheme:dark){
:root[data-accent="green"]:not([data-theme="light"]){--accent:#6FD39D;--accent-soft:#14301F;--accent-ink:#0B1330}
:root[data-accent="purple"]:not([data-theme="light"]){--accent:#B79CFF;--accent-soft:#2A2145;--accent-ink:#150C30}
:root[data-accent="orange"]:not([data-theme="light"]){--accent:#F0B35A;--accent-soft:#33270F;--accent-ink:#2A1A00}
}
:root[data-theme="dark"][data-accent="green"]{--accent:#6FD39D;--accent-soft:#14301F;--accent-ink:#0B1330}
:root[data-theme="dark"][data-accent="purple"]{--accent:#B79CFF;--accent-soft:#2A2145;--accent-ink:#150C30}
:root[data-theme="dark"][data-accent="orange"]{--accent:#F0B35A;--accent-soft:#33270F;--accent-ink:#2A1A00}
:root[data-density="compact"] body{font-size:14px;line-height:1.4}
:root[data-density="compact"] .card{padding:11px}
:root[data-density="compact"] .wrap{padding-block-start:10px}
:root[data-density="compact"] .incrow{padding:3px 0}
:root[data-density="compact"] .tabs{margin-bottom:12px}
:root[data-size="large"] .wrap{zoom:1.15}
:root[data-width="wide"] .wrap{max-width:1280px}
#iw-gear{width:44px;height:44px;border-radius:50%;border:1px solid var(--line,#3a4452);background:var(--surface,#1a212b);color:var(--ink,#e8ecf1);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0;flex:none}
#iw-gear:focus-visible{outline:2px solid var(--accent,#4f8cff);outline-offset:2px}
#iw-ptr{position:fixed;left:50%;top:calc(8px + env(safe-area-inset-top,0px));transform:translate(-50%,-70px);z-index:99997;background:var(--ink,#e8ecf1);color:var(--bg,#0f1419);padding:8px 14px;border-radius:999px;font:600 13px Inter,system-ui,sans-serif;transition:transform .15s}
`;
  let prefs = Object.assign({}, DEFAULT_PREFS), prefTimer = null;
  function loadPrefs(s) {
    let p = {};
    try { p = JSON.parse(localStorage.getItem('iw.prefs') || '{}'); } catch (e) {}
    const m = s && s.user && s.user.user_metadata && s.user.user_metadata.prefs;
    if (m && typeof m === 'object') p = m;
    prefs = Object.assign({}, DEFAULT_PREFS, p);
    applyPrefs();
  }
  function applyPrefs() {
    const r = document.documentElement;
    if (!document.getElementById('iw-prefs-css')) { const st = document.createElement('style'); st.id = 'iw-prefs-css'; st.textContent = PREF_CSS; document.head.appendChild(st); }
    if (prefs.theme === 'light' || prefs.theme === 'dark') r.setAttribute('data-theme', prefs.theme); else r.removeAttribute('data-theme');
    r.setAttribute('data-accent', prefs.accent); r.setAttribute('data-density', prefs.density); r.setAttribute('data-size', prefs.size); r.setAttribute('data-width', prefs.width);
  }
  function setPref(k, v) {
    prefs[k] = v; applyPrefs();
    try { localStorage.setItem('iw.prefs', JSON.stringify(prefs)); } catch (e) {}
    clearTimeout(prefTimer);
    prefTimer = setTimeout(() => { try { Promise.resolve(sb.auth.updateUser({ data: { prefs } })).catch(() => {}); } catch (e) {} }, 700);
  }

  /* Refresh: fetch fresh copies of the page files, drop saved copies, then reload. Works on a pinned home-screen icon. */
  let refreshing = false;
  async function hardRefresh() {
    if (refreshing) return; refreshing = true;
    const note = document.getElementById('iw-ptr'); if (note) { note.textContent = 'Refreshing…'; note.style.transform = 'translate(-50%,0)'; }
    try {
      const urls = [location.href.split('#')[0]].concat([].slice.call(document.scripts).map(x => x.src).filter(u => u && u.indexOf(location.origin) === 0));
      await Promise.all(urls.map(u => fetch(u, { cache: 'reload' }).catch(() => {})));
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r => r.unregister())); }
      if (window.caches && caches.keys) { const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k))); }
    } catch (e) {}
    location.reload();
    setTimeout(() => { refreshing = false; }, 3000);   // if the reload did not happen, allow another try
  }
  function pullToRefresh() {
    const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
    if (!standalone) return;
    let y0 = null, pull = 0;
    const bar = () => { let n = document.getElementById('iw-ptr'); if (!n) { n = document.createElement('div'); n.id = 'iw-ptr'; n.setAttribute('role', 'status'); document.body.appendChild(n); } return n; };
    const busy = () => document.getElementById('iw-auth') || document.getElementById('iw-hh') || document.getElementById('iw-walk') || (document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName));
    document.addEventListener('touchstart', e => { y0 = (window.scrollY <= 0 && !busy() && e.touches && e.touches.length === 1) ? e.touches[0].clientY : null; pull = 0; }, { passive: true });
    document.addEventListener('touchmove', e => {
      if (y0 === null || !e.touches || !e.touches.length) return;
      pull = e.touches[0].clientY - y0;
      if (pull > 20) { const n = bar(); n.textContent = pull > 90 ? 'Release to refresh' : 'Pull to refresh'; n.style.transform = 'translate(-50%,' + Math.min(0, pull - 70) + 'px)'; }
    }, { passive: true });
    document.addEventListener('touchend', () => {
      const go = y0 !== null && pull > 90; y0 = null;
      if (go) hardRefresh(); else { const n = document.getElementById('iw-ptr'); if (n && !refreshing) n.style.transform = 'translate(-50%,-70px)'; }
    }, { passive: true });
  }

  async function accountInfo() {
    const out = { email: session.user.email || '' };
    try {
      const m = new Date().toISOString().slice(0, 7);
      const p = await sb.from('profiles').select('is_admin,ai_enabled,ai_monthly_cap').eq('id', session.user.id).maybeSingle();
      if (p && p.data) Object.assign(out, p.data);
      const u = await sb.from('ai_usage').select('count').eq('user_id', session.user.id).eq('month', m).maybeSingle();
      out.used = (u && u.data && u.data.count) || 0;
    } catch (e) {}
    return out;
  }
  async function showSettings() {
    const acct = await accountInfo();
    const seg = (label, key, opts) => '<div style="margin:12px 0 4px;font-size:13px;color:#9aa6b5">' + label + '</div><div style="display:flex;gap:6px;flex-wrap:wrap">' +
      opts.map(([v, t]) => '<button data-pref="' + key + '" data-val="' + v + '" aria-pressed="' + (prefs[key] === v) + '" style="padding:9px 12px;border-radius:8px;border:1px solid ' + (prefs[key] === v ? '#4f8cff' : '#3a4452') + ';background:' + (prefs[key] === v ? '#26385f' : 'none') + ';color:#e8ecf1;font-size:14px;cursor:pointer">' + t + '</button>').join('') + '</div>';
    const row = (id, t) => '<button id="' + id + '" style="width:100%;text-align:left;padding:12px;margin:6px 0 0;border-radius:8px;border:1px solid #3a4452;background:none;color:#e8ecf1;font-size:15px;cursor:pointer">' + t + '</button>';
    const usage = acct.ai_enabled ? 'Receipt photo reads this month: <b>' + (acct.used || 0) + '</b> of ' + acct.ai_monthly_cap : 'Receipt photo reading is not turned on for this account.';
    const h = '<h2 style="font-size:20px;margin:0 0 4px">Settings</h2>' +
      seg('Color scheme', 'theme', [['auto', 'Match my phone'], ['light', 'Light'], ['dark', 'Dark']]) +
      seg('Accent color', 'accent', Object.keys(ACCENTS).map(k => [k, ACCENTS[k]])) +
      seg('Spacing', 'density', [['comfortable', 'Comfortable'], ['compact', 'Compact']]) +
      seg('Text size', 'size', [['normal', 'Normal'], ['large', 'Large']]) +
      seg('Page width (larger screens)', 'width', [['standard', 'Standard'], ['wide', 'Wide']]) +
      '<div style="border-top:1px solid #3a4452;margin-top:14px;padding-top:6px">' + row('iw-set-refresh', 'Refresh the app') + '<div style="color:#9aa6b5;font-size:13px;margin:4px 2px 0">Loads the newest version. On the home screen you can also pull down from the top.</div>' +
      (hh.unavailable ? '' : row('iw-set-hh', hh.role === 'member' ? 'Shared budget' : 'Household: share with your spouse')) + row('iw-set-how', 'How it works') + (acct.is_admin ? row('iw-set-admin', 'Admin: receipt photo access') : '') + '</div>' +
      '<div style="border-top:1px solid #3a4452;margin-top:14px;padding-top:10px"><div style="font-weight:600">Account</div><div style="color:#cfd7e2;font-size:14px;margin-top:4px">' + esc(acct.email) + '</div>' +
      '<div style="color:#cfd7e2;font-size:14px;margin-top:4px">' + usage + '</div>' +
      '<div style="color:#9aa6b5;font-size:13px;margin-top:6px"><b>Billing:</b> there is nothing to pay. Itemwise has no subscription or charges.</div>' +
      row('iw-set-out', 'Sign out') + '</div>';
    const o = panel(h);
    o.querySelectorAll('[data-pref]').forEach(b => b.onclick = () => { setPref(b.dataset.pref, b.dataset.val); showSettings(); });
    o.querySelector('#iw-set-refresh').onclick = () => { o.remove(); hardRefresh(); };
    const hb = o.querySelector('#iw-set-hh'); if (hb) hb.onclick = () => { o.remove(); showHousehold(); };
    o.querySelector('#iw-set-how').onclick = () => { o.remove(); walkthrough(true); };
    const ab = o.querySelector('#iw-set-admin'); if (ab) ab.onclick = () => { location.href = 'admin.html'; };
    o.querySelector('#iw-set-out').onclick = () => { o.remove(); const x = document.getElementById('iw-out'); if (x) x.click(); };
  }
  function gear() {
    if (document.getElementById('iw-gear')) return;
    const b = document.createElement('button'); b.id = 'iw-gear'; b.type = 'button'; b.setAttribute('aria-label', 'Settings');
    b.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';
    b.onclick = () => showSettings();
    const top = document.querySelector('header.top');
    if (top) top.appendChild(b); else { b.style.cssText += ';position:fixed;top:calc(10px + env(safe-area-inset-top,0px));right:12px;z-index:9000'; document.body.appendChild(b); }
  }


  /* ---- bank connections (Plaid): the app shows the card; this does the talking to the server and to Plaid ---- */
  const bankState = { loaded: false, enabled: false, cap: 0, mine: 0, items: [], busy: false, error: '', reconnect: '', last: '' };
  const BANK_ERR = {
    plaid_not_enabled: 'Bank connections are not turned on for your account.',
    plaid_cap_reached: 'You have used all the bank connections your account allows.',
    plaid_global_cap: 'The site has used all its free bank connections.',
    session_expired: 'Your sign-in expired. Sign in again.',
    login_required: 'The bank needs you to sign in again.',
    plaid_error: 'The bank connection had a problem. Try again in a little while.',
    server_error: 'Something went wrong on the server. Try again.'
  };
  const bankTell = () => { try { if (window.iwBankRender) window.iwBankRender(); } catch (e) {} };
  async function bankCall(action, body) {
    try {
      const r = await fetch(cfg.SUPABASE_URL + '/functions/v1/plaid', { method: 'POST', headers: { 'content-type': 'application/json', apikey: cfg.SUPABASE_ANON_KEY, authorization: 'Bearer ' + (session && session.access_token) }, body: JSON.stringify(Object.assign({ action }, body || {})) });
      let data = {}; try { data = await r.json(); } catch (e) {}
      return { ok: r.ok, status: r.status, data };
    } catch (e) { return { ok: false, status: 0, data: { code: 'network' } }; }
  }
  const bankFail = (r, item) => { bankState.error = BANK_ERR[r.data.code] || 'Could not reach the bank service. Try again.'; bankState.reconnect = r.data.code === 'login_required' ? item || '' : ''; };
  async function bankRefresh() {
    const r = await bankCall('status');
    if (r.ok) { Object.assign(bankState, r.data, { loaded: true }); bank.available = true; }
    else if (r.status === 404 || r.status === 0) { bank.available = false; }   // the server piece is not installed yet: hide the card
    else { bank.available = true; bankState.loaded = true; bankState.enabled = false; }
    bankTell();
  }
  function loadPlaid() {
    if (window.Plaid) return Promise.resolve();
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js'; s.onload = res; s.onerror = () => rej(new Error('load')); document.head.appendChild(s); });
  }
  async function bankSync(auto, reset) {
    if (bankState.busy) return; bankState.busy = true; bankState.error = ''; bankState.reconnect = ''; bankTell();
    let pend = false;
    for (const it of bankState.items.slice()) {
      for (let page = 0; page < 6; page++) {
        const r = await bankCall('sync', Object.assign({ item_id: it.item_id }, (reset && page === 0) ? { reset: true } : {}));
        if (!r.ok) { bankFail(r, it.item_id); break; }
        try { if (window.iwApplyBank) window.iwApplyBank(r.data); } catch (e) { bankState.error = 'Could not add the bank data. Nothing was lost; try again.'; break; }
        pend = pend || !!r.data.pending;
        if (!r.data.pending) await bankCall('ack', { item_id: it.item_id, cursor: r.data.next_cursor });
        if (!r.data.more) break;
      }
    }
    bankState.busy = false; bankState.last = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    try { localStorage.setItem('iw.plaid.last', String(Date.now())); } catch (e) {}
    if (!auto && !bankState.error && window.toast) window.toast(pend ? 'Your bank is still preparing its data. Try again in a few minutes.' : 'Bank updated.');
    bankTell();
  }
  async function bankOpen(token, onDone) {
    try { await loadPlaid(); } catch (e) { bankState.error = 'Could not load the bank connection window. Check your internet and try again.'; bankState.busy = false; bankTell(); return; }
    try { localStorage.setItem('iw.plaid.lt', token); } catch (e) {}
    const h = window.Plaid.create({ token, onSuccess: async (pt, meta) => { await onDone(pt, meta); }, onExit: () => { bankState.busy = false; bankTell(); } });
    h.open();
  }
  const bank = {
    available: false, state: bankState,
    async connect(mode) {
      if (bankState.busy) return; bankState.busy = true; bankState.error = ''; bankTell();
      const r = await bankCall('link_token', { mode });
      if (!r.ok) { bankFail(r); bankState.busy = false; bankTell(); return; }
      await bankOpen(r.data.link_token, async (pt, meta) => {
        const x = await bankCall('exchange', { public_token: pt, institution_name: meta && meta.institution && meta.institution.name });
        bankState.busy = false;
        if (!x.ok) { bankFail(x); bankTell(); return; }
        await bankRefresh(); await bankSync(false);
      });
    },
    async reconnect(itemId) {
      if (bankState.busy) return; bankState.busy = true; bankState.error = ''; bankTell();
      const r = await bankCall('link_token', { item_id: itemId });
      if (!r.ok) { bankFail(r); bankState.busy = false; bankTell(); return; }
      await bankOpen(r.data.link_token, async () => { bankState.busy = false; await bankSync(false); });
    },
    async sync() { await bankSync(false); },
    async resync() { await bankSync(false, true); },
    async remove(itemId) {
      bankState.error = ''; const r = await bankCall('remove', { item_id: itemId });
      if (!r.ok) bankFail(r); else { await bankRefresh(); if (window.toast) window.toast('Connection removed.'); }
      bankTell();
    }
  };
  window.iwBank = bank;
  async function bankStart() {
    await bankRefresh();
    if (/oauth_state_id=/.test(location.search) && bank.available && bankState.enabled) {   // coming back from a bank's own sign-in page
      let tok = ''; try { tok = localStorage.getItem('iw.plaid.lt') || ''; } catch (e) {}
      if (tok) { try { await loadPlaid(); window.Plaid.create({ token: tok, receivedRedirectUri: location.href, onSuccess: async (pt, meta) => { const x = await bankCall('exchange', { public_token: pt, institution_name: meta && meta.institution && meta.institution.name }); if (x.ok) { await bankRefresh(); await bankSync(false); } else { bankFail(x); bankTell(); } }, onExit: () => {} }).open(); } catch (e) {} }
      try { history.replaceState(null, '', location.pathname); } catch (e) {}
    }
    if (!(bank.available && bankState.enabled && bankState.items.length)) return;
    const num = k => { try { return +localStorage.getItem(k) || 0; } catch (e) { return 0; } };
    const nav = (window.performance && performance.getEntriesByType && performance.getEntriesByType('navigation')[0]) || {};
    if (nav.type === 'reload' && Date.now() - num('iw.plaid.refresh') > 5 * 60e3) await bankFetchNow();   // you pressed refresh: have the bank checked right now
    else if (Date.now() - num('iw.plaid.last') > 60e3) bankSync(true);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && bankState.items.length && Date.now() - num('iw.plaid.last') > 30 * 60e3) bankSync(true); });
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  /* Ask Plaid to fetch from each bank now, give it a few seconds, then bring the charges in; once more shortly after for slower banks. */
  async function bankFetchNow() {
    try { localStorage.setItem('iw.plaid.refresh', String(Date.now())); } catch (e) {}
    await Promise.all(bankState.items.map(it => bankCall('refresh', { item_id: it.item_id })));
    await sleep(cfg.REFRESH_WAIT_MS != null ? cfg.REFRESH_WAIT_MS : 6000);
    await bankSync(true);
    setTimeout(() => bankSync(true), cfg.REFRESH_SECOND_MS != null ? cfg.REFRESH_SECOND_MS : 25000);
  }

  async function done(s) {
    session = s; hh = await fetchHH(); dataUid = budgetUid(hh, s); loadPrefs(s);
    const o = document.getElementById('iw-auth'); if (o) o.remove(); chip(); gear(); resolveReady(s); setTimeout(bankStart, 800); setTimeout(() => walkthrough(false), 600);
  }

  /* ---- refresh: a home-screen app has no reload button, so give it two ways ---- */
  function refreshNow() {
    document.dispatchEvent(new Event('iw-refresh'));
    const go = () => location.reload();
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) navigator.serviceWorker.getRegistration().then(r => r && r.update()).catch(() => {});
      if (window.caches && caches.keys) caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))).then(go, go); else go();
    } catch (e) { go(); }
  }
  (function pullToRefresh() {
    const standalone = () => window.navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    let y0 = null, tip = null;
    const free = () => !document.getElementById('iw-hh') && !document.getElementById('iw-auth') && !document.getElementById('iw-walk');
    const hide = () => { if (tip) { tip.remove(); tip = null; } };
    document.addEventListener('touchstart', e => { y0 = (standalone() && window.scrollY <= 0 && e.touches && e.touches.length === 1 && free()) ? e.touches[0].clientY : null; }, { passive: true });
    document.addEventListener('touchmove', e => {
      if (y0 === null) return; const dy = e.touches[0].clientY - y0;
      if (dy > 30) {
        if (!tip) { tip = document.createElement('div'); tip.style.cssText = 'position:fixed;top:calc(8px + env(safe-area-inset-top,0px));left:50%;transform:translateX(-50%);z-index:99997;background:#26303d;color:#e8ecf1;padding:6px 14px;border-radius:16px;font:13px Inter,system-ui,sans-serif'; document.body.appendChild(tip); }
        tip.textContent = dy > 110 ? 'Release to refresh' : 'Pull down to refresh';
      } else hide();
    }, { passive: true });
    document.addEventListener('touchend', e => {
      if (y0 === null) return; const dy = (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientY : y0) - y0; y0 = null; hide();
      if (dy > 110) refreshNow();
    }, { passive: true });
  })();

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

  const NS = { user: { id: async () => dataUid || (session && session.user.id) }, db: null, sample: null };
  window.claude = { use: async name => { await ready; if (name === 'db') return NS.db || (NS.db = makeDb()); if (name === 'sample') return NS.sample || (NS.sample = makeSample()); return NS[name] || null; } };

  function start() {
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || !window.supabase) {
      overlay('<h1 style="font-size:22px">Itemwise is not set up yet</h1><p style="color:#9aa6b5">Add your Supabase address and key to config.js (see README step 5).</p>'); return;
    }
    try { prefs = Object.assign({}, DEFAULT_PREFS, JSON.parse(localStorage.getItem('iw.prefs') || '{}')); applyPrefs(); } catch (e) {}
    pullToRefresh();
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    let recovering = false;
    sb.auth.onAuthStateChange((ev, s) => {
      if (ev === 'PASSWORD_RECOVERY') { recovering = true; session = s; showReset(); return; }
      if (ev === 'SIGNED_IN' && s && !recovering) done(s);
      if (ev === 'TOKEN_REFRESHED' && s) session = s;
      if (ev === 'SIGNED_OUT') { session = null; }
    });
    const linkErr = /error_code=(otp_expired|access_denied)/.test(location.hash) ? 'That email link expired or was already used. Sign in below. If it says your email is not confirmed, tap Resend.' : '';
    sb.auth.getSession().then(r => { const s = r.data && r.data.session; if (s && !recovering) done(s); else if (!recovering) showAuth('in', linkErr); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
