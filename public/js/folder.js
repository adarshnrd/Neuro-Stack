/**
 * NeuroStack Folder Agent — web client.
 * Browse to a folder, describe the work, and watch the autonomous run stream in,
 * approving high-risk commands inline (auto/manual modes).
 */
document.addEventListener('DOMContentLoaded', () => {
  const el = (id) => document.getElementById(id);
  const currentPathEl = el('current-path');
  const dirListEl = el('dir-list');
  const selectedEl = el('selected');
  const promptEl = el('prompt');
  const logEl = el('log');
  const approvalsEl = el('approvals');

  let selectedFolder = null;
  let running = false;

  // ── Folder browser ──
  async function browse(pathArg) {
    try {
      const url = pathArg ? `/api/folder/browse?path=${encodeURIComponent(pathArg)}` : '/api/folder/browse';
      const res = await fetch(url);
      if (res.status === 401) { window.location.href = '/signin'; return; }
      const data = await res.json();
      currentPathEl.textContent = data.current;
      el('parent-btn').dataset.path = data.parent || '';
      el('parent-btn').disabled = !data.parent;

      dirListEl.innerHTML = '';
      data.dirs.forEach((d) => {
        const li = document.createElement('li');
        li.textContent = '📁 ' + d.name;
        li.addEventListener('click', () => browse(d.path));
        dirListEl.appendChild(li);
      });
      if (data.dirs.length === 0) {
        const li = document.createElement('li');
        li.className = 'muted';
        li.textContent = '(no sub-folders)';
        dirListEl.appendChild(li);
      }
    } catch (err) {
      currentPathEl.textContent = 'Failed to browse.';
    }
  }

  el('parent-btn').addEventListener('click', (e) => {
    const p = e.currentTarget.dataset.path;
    if (p) browse(p);
  });

  el('use-btn').addEventListener('click', () => {
    selectedFolder = currentPathEl.textContent;
    selectedEl.textContent = 'Selected folder: ' + selectedFolder;
    el('start-btn').disabled = false;
    el('resume-btn').disabled = false;
    el('status-btn').disabled = false;
  });

  // ── Logging ──
  function logLine(text, cls) {
    if (logEl.textContent === 'Idle.') logEl.textContent = '';
    const line = document.createElement('div');
    if (cls) line.className = cls;
    line.textContent = text;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }

  // ── Approvals ──
  function showApproval(evt) {
    const box = document.createElement('div');
    box.className = 'approval';
    box.innerHTML = `<div>⚠️ ${escapeHtml(evt.message)}</div><div>Command: <code></code></div>`;
    box.querySelector('code').textContent = evt.data.command;
    const row = document.createElement('div');
    row.className = 'row';
    row.style.marginTop = '8px';
    const allow = document.createElement('button');
    allow.className = 'primary small';
    allow.textContent = 'Allow';
    const deny = document.createElement('button');
    deny.className = 'small';
    deny.textContent = 'Deny';
    const decide = async (approved) => {
      allow.disabled = deny.disabled = true;
      await fetch('/api/folder/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvalId: evt.data.approvalId, approved }),
      });
      box.remove();
      logLine(`  ${approved ? '✓ allowed' : '✗ denied'}: ${evt.data.command}`);
    };
    allow.addEventListener('click', () => decide(true));
    deny.addEventListener('click', () => decide(false));
    row.append(allow, deny);
    box.appendChild(row);
    approvalsEl.appendChild(box);
  }

  // ── Run / Resume via SSE ──
  async function run(resume) {
    if (!selectedFolder || running) return;
    if (!resume && !promptEl.value.trim()) { logLine('Enter a prompt first.', 'error'); return; }

    running = true;
    setBusy(true);
    approvalsEl.innerHTML = '';
    logEl.textContent = '';
    logLine(resume ? `⟳ Resuming ${selectedFolder}` : `▶ Starting in ${selectedFolder}`);

    try {
      const res = await fetch('/api/folder/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selectedFolder, prompt: promptEl.value, mode: el('mode').value, resume }),
      });
      if (!res.ok || !res.body) { logLine('Failed to start run.', 'error'); return; }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() || '';
        for (const frame of frames) {
          const line = frame.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          let evt;
          try { evt = JSON.parse(line.slice(6)); } catch { continue; }
          handleEvent(evt);
        }
      }
    } catch (err) {
      logLine('Connection error during run.', 'error');
    } finally {
      running = false;
      setBusy(false);
    }
  }

  function handleEvent(evt) {
    switch (evt.type) {
      case 'approval_request': showApproval(evt); break;
      case 'round': logLine('⚙ ' + evt.message); break;
      case 'handoff': logLine('🔀 ' + evt.message, 'handoff'); break;
      case 'done': logLine('🏁 ' + evt.message, 'done'); break;
      case 'paused': logLine('⏸ ' + evt.message, 'paused'); break;
      case 'error': logLine('⚠ ' + evt.message, 'error'); break;
      case 'result':
        logLine('── Result (' + (evt.data?.status || '') + ') ──', 'done');
        logLine(evt.message);
        break;
      default: if (evt.message) logLine(evt.message);
    }
  }

  function setBusy(busy) {
    el('start-btn').disabled = busy || !selectedFolder;
    el('resume-btn').disabled = busy || !selectedFolder;
  }

  el('start-btn').addEventListener('click', () => run(false));
  el('resume-btn').addEventListener('click', () => run(true));
  el('status-btn').addEventListener('click', async () => {
    if (!selectedFolder) return;
    const res = await fetch(`/api/folder/status?path=${encodeURIComponent(selectedFolder)}`);
    const data = await res.json();
    logEl.textContent = data.status || 'No status.';
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
  }

  browse();
});
