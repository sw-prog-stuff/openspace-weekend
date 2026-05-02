const STORAGE = {
  name: 'os.name',
  voterId: 'os.voterId',
  github: 'os.github',
};

const USERS = {
  Sven:   { admin: true,  password: 'WE!' },
  Chris:  { admin: false, password: 'WE!' },
  Thomas: { admin: false, password: 'WE!' },
};

const state = {
  config: null,
  vision: { proposals: [], votes: {} },
  sessions: { sessions: [] },
  identity: { name: '', voterId: '', admin: false },
  github: { owner: '', repo: '', branch: 'main', token: '' },
};

function $(sel, root = document) { return root.querySelector(sel); }
function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }
function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('error', isError);
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 3200);
}
function fmtTime(d) {
  return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}
function fmtDay(d) {
  return d.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long' });
}
function toLocalInput(iso) {
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function loadIdentity() {
  const stored = localStorage.getItem(STORAGE.name) || '';
  state.identity.name = USERS[stored] ? stored : '';
  let vid = localStorage.getItem(STORAGE.voterId);
  if (!vid) { vid = uid(); localStorage.setItem(STORAGE.voterId, vid); }
  state.identity.voterId = vid;
}

function applyIdentity() {
  const u = USERS[state.identity.name];
  state.identity.admin = !!u?.admin;
  $('#who-name').textContent = state.identity.name || '—';
  const rb = $('#who-role');
  if (rb) rb.textContent = state.identity.admin ? 'admin' : (state.identity.name ? 'user' : '');
  const lo = $('#btn-logout');
  if (lo) lo.hidden = !state.identity.name;
  document.body.classList.toggle('is-admin', state.identity.admin);
  if (!state.identity.admin && location.hash === '#settings') location.hash = '#vision';
}

function loadGithub() {
  const raw = localStorage.getItem(STORAGE.github);
  if (raw) {
    try { Object.assign(state.github, JSON.parse(raw)); } catch {}
  }
  if (!state.github.owner || !state.github.repo) {
    const host = location.hostname;
    const parts = location.pathname.split('/').filter(Boolean);
    if (host.endsWith('.github.io') && parts.length > 0) {
      state.github.owner = host.replace('.github.io', '');
      state.github.repo = parts[0];
      state.github.branch = state.github.branch || 'main';
    }
  }
}
function saveGithub() {
  localStorage.setItem(STORAGE.github, JSON.stringify(state.github));
}

async function loadJson(path, fallback) {
  try {
    const r = await fetch(path + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch {
    return structuredClone(fallback);
  }
}
async function loadAllData() {
  state.config = await loadJson('data/config.json', {
    title: 'OpenSpace', start: '', end: '', slotMinutes: 60,
  });
  state.vision = await loadJson('data/vision.json', { proposals: [], votes: {} });
  state.sessions = await loadJson('data/sessions.json', { sessions: [] });
  if (state.config.title) {
    $('#title').textContent = state.config.title;
    document.title = state.config.title;
  }
}

function ghCheck() {
  const { owner, repo, token } = state.github;
  if (!owner || !repo || !token) {
    toast('GitHub-Settings fehlen — siehe Settings', true);
    location.hash = '#settings';
    throw new Error('no github config');
  }
  if (token.length < 60) {
    toast(`Token nur ${token.length} Zeichen — unvollständig. Settings → Token neu pasten.`, true);
    location.hash = '#settings';
    throw new Error('token truncated');
  }
}

async function ghReadJson(path) {
  ghCheck();
  const { owner, repo, branch, token } = state.github;
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}&t=${Date.now()}`;
  const r = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json' },
    cache: 'no-store',
  });
  if (r.status === 404) return null;
  if (r.status === 401) throw new Error('401 — Token ungültig (revoked?)');
  if (!r.ok) throw new Error('GET ' + r.status);
  const j = await r.json();
  const text = decodeURIComponent(escape(atob((j.content || '').replace(/\n/g, ''))));
  return { data: JSON.parse(text || 'null'), sha: j.sha };
}

async function ghPutJson(path, data, message, sha) {
  const { owner, repo, branch, token } = state.github;
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const body = {
    message,
    branch,
    content: btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2)))),
  };
  if (sha) body.sha = sha;
  const r = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (r.ok) return { ok: true };
  const text = await r.text();
  return { ok: false, status: r.status, text };
}

const PATHS = {
  config: 'data/config.json',
  vision: 'data/vision.json',
  sessions: 'data/sessions.json',
};
const FALLBACK = {
  config: { title: 'OpenSpace', start: '', end: '', slotMinutes: 60 },
  vision: { proposals: [], votes: {} },
  sessions: { sessions: [] },
};

async function saveMerged(kind, mutate) {
  ghCheck();
  const path = PATHS[kind];
  const msg = `update ${kind}`;
  let lastErr = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    const fresh = await ghReadJson(path);
    const cur = fresh?.data ?? structuredClone(FALLBACK[kind]);
    const next = mutate(structuredClone(cur));
    state[kind] = next;
    if (kind === 'vision') renderVision();
    else if (kind === 'sessions') renderSessions();
    const r = await ghPutJson(path, next, msg, fresh?.sha);
    if (r.ok) { toast('Gespeichert'); return; }
    if (r.status === 409) {
      lastErr = '409 conflict, retry ' + (attempt + 1);
      await new Promise(res => setTimeout(res, 200 + Math.random() * 300));
      continue;
    }
    if (r.status === 401) throw new Error('401 — Token ungültig');
    throw new Error('PUT ' + r.status + ' ' + r.text);
  }
  throw new Error('Konflikt — ' + lastErr + '. Seite neu laden und nochmal.');
}

function route() {
  const hash = (location.hash.replace('#', '') || 'vision');
  const valid = ['vision', 'sessions', 'settings'];
  const v = valid.includes(hash) ? hash : 'vision';
  $$('.view').forEach(el => el.classList.add('hidden'));
  $('#view-' + v)?.classList.remove('hidden');
  $$('.nav-link').forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + v));
  if (v === 'vision') renderVision();
  if (v === 'sessions') renderSessions();
  if (v === 'settings') renderSettings();
}

function voteCount(pid) { return (state.vision.votes[pid] || []).length; }

function renderVision() {
  const root = $('#proposals');
  const props = [...state.vision.proposals];
  props.sort((a, b) => voteCount(b.id) - voteCount(a.id) || (a.createdAt || '').localeCompare(b.createdAt || ''));
  if (props.length === 0) {
    root.innerHTML = '<p class="muted">Noch keine Vorschläge. Mach den Anfang.</p>';
    return;
  }
  root.innerHTML = props.map(p => {
    const vc = voteCount(p.id);
    const voted = (state.vision.votes[p.id] || []).includes(state.identity.voterId);
    const goalsHtml = (p.goals || '').split('\n').map(s => s.trim()).filter(Boolean)
      .map(g => `<li>${escapeHtml(g)}</li>`).join('');
    return `
      <article class="proposal" data-id="${p.id}">
        <div class="motto">${escapeHtml(p.motto)}</div>
        <p class="headline">${escapeHtml(p.headline)}</p>
        ${goalsHtml ? `<ul class="goals">${goalsHtml}</ul>` : ''}
        ${p.vision ? `<p class="vision">${escapeHtml(p.vision)}</p>` : ''}
        <div class="meta">
          <span class="author">— ${escapeHtml(p.author || 'anonym')}</span>
          <button class="vote-btn ${voted ? 'voted' : ''}" data-vote="${p.id}">▲ ${vc}</button>
        </div>
      </article>
    `;
  }).join('');
}

async function toggleVote(pid) {
  if (!state.identity.name) { openLogin(); return; }
  const myId = state.identity.voterId;
  try {
    await saveMerged('vision', v => {
      v.votes ||= {};
      const arr = v.votes[pid] = v.votes[pid] || [];
      const i = arr.indexOf(myId);
      if (i >= 0) arr.splice(i, 1); else arr.push(myId);
      return v;
    });
  } catch (e) { toast('Vote-Fehler: ' + e.message, true); }
}

async function addProposal(data) {
  const p = {
    id: uid(),
    author: state.identity.name,
    motto: data.motto.trim(),
    headline: data.headline.trim(),
    goals: (data.goals || '').trim(),
    vision: (data.vision || '').trim(),
    createdAt: new Date().toISOString(),
  };
  try {
    await saveMerged('vision', v => {
      v.proposals ||= [];
      v.proposals.push(p);
      return v;
    });
  } catch (e) { toast('Speichern fehlgeschlagen: ' + e.message, true); }
}

function renderSessions() {
  const root = $('#slots');
  const meta = $('#sessions-meta');
  if (!state.config.start || !state.config.end) {
    root.innerHTML = '<p class="muted">Noch keine Zeiten gesetzt — bitte in <a href="#settings" style="color:var(--cyan)">Settings</a> festlegen.</p>';
    meta.textContent = '';
    return;
  }
  const start = new Date(state.config.start);
  const end = new Date(state.config.end);
  const slotMin = Number(state.config.slotMinutes) || 60;
  if (!(start < end)) {
    root.innerHTML = '<p class="muted">Endzeit muss nach Startzeit liegen.</p>';
    meta.textContent = '';
    return;
  }
  meta.textContent = `${fmtDay(start)} ${fmtTime(start)} → ${fmtDay(end)} ${fmtTime(end)} · Slots à ${slotMin} min`;

  const slots = [];
  let cur = new Date(start);
  let guard = 0;
  while (cur < end && guard++ < 200) {
    const next = new Date(cur.getTime() + slotMin * 60000);
    slots.push({ start: new Date(cur), end: new Date(Math.min(next.getTime(), end.getTime())) });
    cur = next;
  }
  let html = '';
  let lastDay = '';
  for (const s of slots) {
    const dayKey = s.start.toDateString();
    if (dayKey !== lastDay) {
      html += `<div class="day-header">${fmtDay(s.start)}</div>`;
      lastDay = dayKey;
    }
    const session = state.sessions.sessions.find(x => x.slotStart === s.start.toISOString());
    const filled = !!session;
    html += `
      <div class="slot ${filled ? 'filled' : ''}" data-start="${s.start.toISOString()}">
        <div class="time">${fmtTime(s.start)} – ${fmtTime(s.end)}</div>
        <div class="body">
          ${filled
            ? `<div class="title">${escapeHtml(session.title)}</div>
               <div class="owner">→ ${escapeHtml(session.owner)}</div>`
            : `<div class="empty">+ leer · klicken zum Befüllen</div>`}
        </div>
      </div>`;
  }
  root.innerHTML = html;
}

async function saveSession(data) {
  try {
    await saveMerged('sessions', s => {
      s.sessions ||= [];
      const idx = data.id ? s.sessions.findIndex(x => x.id === data.id) : -1;
      if (idx >= 0) s.sessions[idx] = { ...s.sessions[idx], ...data };
      else s.sessions.push({ ...data, id: uid(), createdAt: new Date().toISOString() });
      return s;
    });
  } catch (e) { toast('Speichern fehlgeschlagen: ' + e.message, true); }
}
async function deleteSession(id) {
  try {
    await saveMerged('sessions', s => {
      s.sessions = (s.sessions || []).filter(x => x.id !== id);
      return s;
    });
  } catch (e) { toast('Löschen fehlgeschlagen: ' + e.message, true); }
}

function renderSettings() {
  const f = $('#form-settings');
  f.title.value = state.config.title || '';
  f.start.value = state.config.start ? toLocalInput(state.config.start) : '';
  f.end.value = state.config.end ? toLocalInput(state.config.end) : '';
  f.slotMinutes.value = state.config.slotMinutes || 60;
  const g = $('#form-github');
  g.owner.value = state.github.owner || '';
  g.repo.value = state.github.repo || '';
  g.branch.value = state.github.branch || 'main';
  g.token.value = state.github.token || '';
  updateTokenLen();
}

function updateTokenLen() {
  const ta = $('#form-github [name=token]');
  const span = $('#token-len');
  if (!ta || !span) return;
  const n = (ta.value || '').trim().length;
  span.textContent = `${n} Zeichen` + (n === 0 ? '' : n < 80 ? ' · zu kurz, fine-grained PATs sind ~93' : ' · ok');
  span.classList.toggle('ok', n >= 80);
  span.classList.toggle('bad', n > 0 && n < 80);
}

async function testConnection() {
  const { owner, repo, branch, token } = state.github;
  if (!owner || !repo || !token) { toast('Owner / Repo / Token fehlen', true); return; }
  toast('Teste Verbindung …');
  try {
    const r1 = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json' },
    });
    if (r1.status === 401) { toast('✗ 401 — Token ungültig oder revoked', true); return; }
    if (r1.status === 404) { toast('✗ 404 — Repo nicht gefunden oder Token hat keinen Zugriff', true); return; }
    if (!r1.ok) { toast('✗ Repo-Check ' + r1.status, true); return; }
    const r2 = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/data/vision.json?ref=${encodeURIComponent(branch)}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json' },
    });
    if (!r2.ok && r2.status !== 404) { toast('✗ Contents-Read ' + r2.status, true); return; }
    toast('✓ Verbindung ok — Lese-Zugriff bestätigt');
  } catch (e) {
    toast('✗ Netzwerk-Fehler: ' + e.message, true);
  }
}

let _pickedUser = '';
function openLogin() {
  const dlg = $('#dlg-login');
  $('#login-error').hidden = true;
  $('#dlg-login input[name=password]').value = '';
  _pickedUser = '';
  $$('.user-pick').forEach(b => b.classList.remove('active'));
  dlg.showModal();
}

document.addEventListener('click', e => {
  const b = e.target.closest('.user-pick');
  if (!b) return;
  _pickedUser = b.dataset.user;
  $$('.user-pick').forEach(x => x.classList.toggle('active', x === b));
  $('#dlg-login input[name=password]').focus();
});

$('#form-login').addEventListener('submit', e => {
  e.preventDefault();
  const pw = $('#dlg-login input[name=password]').value;
  const err = $('#login-error');
  if (!_pickedUser || !USERS[_pickedUser]) {
    err.textContent = 'Bitte einen Namen wählen';
    err.hidden = false; return;
  }
  if (USERS[_pickedUser].password !== pw) {
    err.textContent = 'Falsches Passwort';
    err.hidden = false; return;
  }
  state.identity.name = _pickedUser;
  localStorage.setItem(STORAGE.name, _pickedUser);
  applyIdentity();
  $('#dlg-login').close();
  route();
});

document.addEventListener('click', e => {
  if (e.target.id === 'btn-logout') {
    state.identity.name = '';
    localStorage.removeItem(STORAGE.name);
    applyIdentity();
    openLogin();
  }
});

$('#btn-new-proposal').addEventListener('click', () => {
  if (!state.identity.name) { openLogin(); return; }
  const dlg = $('#dlg-proposal');
  dlg.querySelector('form').reset();
  dlg.showModal();
});
$('#dlg-proposal').addEventListener('close', e => {
  if (e.target.returnValue !== 'ok') return;
  const fd = new FormData(e.target.querySelector('form'));
  if (!fd.get('motto') || !fd.get('headline')) return;
  addProposal({
    motto: fd.get('motto'),
    headline: fd.get('headline'),
    goals: fd.get('goals') || '',
    vision: fd.get('vision') || '',
  });
});

$('#proposals').addEventListener('click', e => {
  const btn = e.target.closest('[data-vote]');
  if (btn) toggleVote(btn.dataset.vote);
});

$('#slots').addEventListener('click', e => {
  const slot = e.target.closest('.slot');
  if (!slot) return;
  if (!state.identity.name) { openLogin(); return; }
  const start = slot.dataset.start;
  const session = state.sessions.sessions.find(x => x.slotStart === start);
  const dlg = $('#dlg-session');
  const f = dlg.querySelector('form');
  f.reset();
  $('#dlg-session-title').textContent = session ? 'Session bearbeiten' : 'Neue Session';
  f.elements.id.value = session?.id || '';
  f.elements.slotStart.value = start;
  f.elements.title.value = session?.title || '';
  f.elements.owner.value = session?.owner || state.identity.name;
  f.elements.notes.value = session?.notes || '';
  f.querySelector('[data-only-existing]').style.display = session ? '' : 'none';
  dlg.showModal();
});
$('#dlg-session').addEventListener('close', e => {
  const ret = e.target.returnValue;
  const f = e.target.querySelector('form');
  const fd = new FormData(f);
  const id = fd.get('id');
  if (ret === 'delete' && id) { deleteSession(id); return; }
  if (ret !== 'ok') return;
  if (!fd.get('title') || !fd.get('owner')) return;
  saveSession({
    id: id || undefined,
    slotStart: fd.get('slotStart'),
    title: fd.get('title'),
    owner: fd.get('owner'),
    notes: fd.get('notes') || '',
  });
});

$('#form-settings').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const newConfig = {
    title: fd.get('title'),
    start: new Date(fd.get('start')).toISOString(),
    end: new Date(fd.get('end')).toISOString(),
    slotMinutes: parseInt(fd.get('slotMinutes'), 10),
  };
  $('#title').textContent = newConfig.title;
  document.title = newConfig.title;
  try { await saveMerged('config', () => newConfig); }
  catch (err) { toast('Speichern fehlgeschlagen: ' + err.message, true); }
});

$('#form-github').addEventListener('submit', e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const token = (fd.get('token') || '').replace(/\s+/g, '');
  if (token && token.length < 60) {
    toast(`Token zu kurz (${token.length}) — Paste hat geklemmt. Nochmal sauber pasten.`, true);
    return;
  }
  state.github = {
    owner: (fd.get('owner') || '').trim(),
    repo: (fd.get('repo') || '').trim(),
    branch: (fd.get('branch') || '').trim() || 'main',
    token,
  };
  saveGithub();
  toast('GitHub-Verbindung gespeichert');
});

document.addEventListener('input', e => {
  if (e.target.matches('#form-github [name=token]')) updateTokenLen();
});

document.addEventListener('click', e => {
  if (e.target.id === 'btn-test-conn') testConnection();
});

window.addEventListener('hashchange', route);

function bootstrapFromUrl() {
  const u = new URL(location.href);
  const p = u.searchParams;
  let changed = false;
  const t = p.get('t');
  if (t && t.replace(/\s+/g, '').length >= 60) {
    const cur = JSON.parse(localStorage.getItem(STORAGE.github) || '{}');
    cur.token = t.replace(/\s+/g, '');
    if (p.get('o')) cur.owner = p.get('o');
    if (p.get('r')) cur.repo = p.get('r');
    cur.branch = p.get('b') || cur.branch || 'main';
    if (!cur.owner || !cur.repo) {
      const host = location.hostname;
      const parts = location.pathname.split('/').filter(Boolean);
      if (host.endsWith('.github.io') && parts.length > 0) {
        cur.owner = cur.owner || host.replace('.github.io', '');
        cur.repo = cur.repo || parts[0];
      }
    }
    localStorage.setItem(STORAGE.github, JSON.stringify(cur));
    changed = true;
  }
  const n = p.get('n');
  if (n) { localStorage.setItem(STORAGE.name, n); changed = true; }
  if (changed) {
    ['t', 'o', 'r', 'b', 'n'].forEach(k => p.delete(k));
    const qs = u.searchParams.toString();
    history.replaceState({}, '', u.pathname + (qs ? '?' + qs : '') + u.hash);
    setTimeout(() => toast('Setup gespeichert ✓'), 200);
  }
}

(async function init() {
  bootstrapFromUrl();
  loadIdentity();
  loadGithub();
  applyIdentity();
  await loadAllData();
  route();
  if (!state.identity.name) openLogin();
})();
