/**
 * Project NeuroStack — Chat Client
 * Premium chat UI with markdown rendering, streaming effect,
 * code copy buttons, message actions, and @ command autocomplete.
 *
 * Updated: Auth-aware, multi-session support, paginated conversation history.
 */
document.addEventListener('DOMContentLoaded', () => {
  // ── DOM References ──
  const messagesContainer = document.getElementById('chat-messages');
  const inputEl            = document.getElementById('chat-input');
  const sendBtn            = document.getElementById('send-btn');
  const statusEl           = document.getElementById('connection-status');
  const commandPopup       = document.getElementById('command-popup');
  const welcomeScreen      = document.getElementById('welcome-screen');
  const sidebarToggle      = document.getElementById('sidebar-toggle');
  const sidebar            = document.getElementById('sidebar');
  const newSessionBtn      = document.getElementById('new-session-btn');

  // ── State ──
  let sessionId            = null;
  let availableCommands    = [];
  let selectedCommandIdx   = -1;
  let isNewSessionPending  = false;

  // ── Per-session work (sessions run independently, in parallel) ──
  const busySessions       = new Set(); // sessions with a chat request / agent run in flight
  const approvalSessions   = new Set(); // sessions whose folder run is waiting on Allow/Deny
  const liveRows           = new Map(); // sessionId → message rows of in-flight work (re-shown on switch-back)

  // ── Pagination state ──
  let oldestCursor       = null;
  let hasMoreMessages    = false;
  let isLoadingHistory   = false;

  // ── Auth state ──
  let currentUser        = null;

  // ── Folder-agent mode (admin only) ──
  // Each session can be bound to one project folder (saved on the server). In a
  // bound session, prompts run the autonomous folder agent there instead of the
  // conversational model — so different sessions can work on different projects.
  const sessionFolders     = new Map(); // sessionId → bound project folder
  const folderBtn          = document.getElementById('folder-btn');
  const folderBar          = document.getElementById('folder-bar');
  const folderBarPath      = document.getElementById('folder-bar-path');
  const folderModeSelect   = document.getElementById('folder-mode');
  const folderResumeBtn    = document.getElementById('folder-resume-btn');
  const folderClearBtn     = document.getElementById('folder-clear-btn');
  const folderModal        = document.getElementById('folder-modal');
  const folderCurrentPath  = document.getElementById('folder-current-path');
  const folderDirList      = document.getElementById('folder-dir-list');
  const folderParentBtn    = document.getElementById('folder-parent-btn');
  const defaultPlaceholder = inputEl.placeholder;
  let isFolderModeEnabled  = false;
  let browsePath           = null;
  let browseParent         = null;

  // ── Configure marked.js ──
  // (Code highlighting happens in processCodeBlocks — the `highlight` option
  // was removed from marked in v5 and would be silently ignored.)
  if (window.marked) {
    window.marked.setOptions({
      breaks: true,
      gfm: true,
    });
  }

  // ── Initialize ──
  setStatus('ready', 'Ready');
  fetchCommands();
  checkAuth();

  // ── New Session button (static button from template) ──
  newSessionBtn?.addEventListener('click', createNewSession);

  // ── Sidebar toggle ──
  sidebarToggle?.addEventListener('click', () => {
    sidebar?.classList.toggle('collapsed');
  });

  // ── Quick action buttons ──
  document.querySelectorAll('.quick-action').forEach((btn) => {
    btn.addEventListener('click', () => {
      const prompt = btn.dataset.prompt;
      if (prompt) {
        inputEl.value = prompt;
        sendMessage();
      }
    });
  });

  // ── Auto-resize textarea ──
  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 180) + 'px';
  });

  // ── Scroll-up pagination ──
  messagesContainer.addEventListener('scroll', () => {
    if (
      messagesContainer.scrollTop < 60 &&
      hasMoreMessages &&
      !isLoadingHistory &&
      sessionId
    ) {
      loadOlderMessages();
    }
  });

  // ═══════════════════════════════════════════════
  //  AUTH
  // ═══════════════════════════════════════════════

  async function checkAuth() {
    try {
      const res = await fetch('/api/auth/me');
      const data = await res.json();

      if (data.success && data.user) {
        currentUser = data.user;
        renderUserInfo();
        initFolderMode();
        loadSessions();
      } else {
        window.location.href = '/signin';
      }
    } catch (_) {
      window.location.href = '/signin';
    }
  }

  function renderUserInfo() {
    const userInfoEl = document.getElementById('user-info');
    if (userInfoEl && currentUser) {
      userInfoEl.innerHTML = `
        <span class="user-name">${escapeHtml(currentUser.username)}</span>
        <span class="user-role">${currentUser.role}</span>
        <button id="logout-btn" class="logout-btn" title="Logout">🚪</button>
      `;
      document.getElementById('logout-btn')?.addEventListener('click', handleLogout);
    }
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/signin';
  }

  // ═══════════════════════════════════════════════
  //  SESSIONS
  // ═══════════════════════════════════════════════

  async function loadSessions(skipAutoSelect = false) {
    try {
      const res = await fetch('/api/sessions');
      const data = await res.json();
      const sessions = data.sessions || [];
      sessionFolders.clear();
      sessions.forEach((s) => { if (s.folderPath) sessionFolders.set(s.id, s.folderPath); });
      renderSessionList(sessions);
      renderFolderBar();
      const viewedSession = sessions.find((s) => s.id === sessionId);
      if (viewedSession?.title) updateSessionHeaderTitle(viewedSession.title);

      // Only auto-select the latest session on initial page load.
      // Skip when: user is composing a new session, or caller explicitly requested skip.
      if (!skipAutoSelect && !isNewSessionPending && sessionId === null && sessions.length > 0) {
        await switchSession(sessions[0].id);
      } else if (!skipAutoSelect && !isNewSessionPending && sessionId === null) {
        showWelcomeScreen();
      }
    } catch (err) {
      console.error('Failed to load sessions', err);
    }
  }

  function renderSessionList(sessions) {
    const listEl = document.getElementById('session-list');
    if (!listEl) return;

    listEl.innerHTML = '';

    // Session items
    sessions.forEach((s) => {
      const item = document.createElement('div');
      item.className = 'session-item' + (s.id === sessionId ? ' active' : '');
      item.dataset.sessionId = s.id;

      const title = s.title || 'Untitled Chat';
      const time = new Date(s.lastActiveAt).toLocaleDateString([], {
        month: 'short', day: 'numeric',
      });

      item.innerHTML = `
        <span class="session-title">${escapeHtml(title)}</span>
        <span class="session-time">${time}</span>
      `;
      if (s.folderPath) {
        const folderLabel = document.createElement('span');
        folderLabel.className = 'session-folder';
        folderLabel.textContent = '📁 ' + folderName(s.folderPath);
        folderLabel.title = s.folderPath;
        item.appendChild(folderLabel);
      }
      item.addEventListener('click', () => switchSession(s.id));
      listEl.appendChild(item);
    });
    refreshSessionBadges();
  }

  /** Marks sidebar sessions that are working, or waiting on an approval, in the background. */
  function refreshSessionBadges() {
    document.querySelectorAll('.session-item').forEach((el) => {
      const id = el.dataset?.sessionId;
      el.classList.toggle('running', busySessions.has(id));
      el.classList.toggle('needs-approval', approvalSessions.has(id));
    });
  }

  function folderName(folderPath) {
    return folderPath.split(/[\\/]/).filter(Boolean).pop() || folderPath;
  }

  /**
   * Resets the UI to a fresh "new session" state.
   * The actual DB session is created lazily when the user sends their first message.
   */
  function createNewSession() {
    if (!currentUser) return;

    // Reset client state — no DB session yet
    sessionId = null;
    isNewSessionPending = true;
    messagesContainer.innerHTML = '';
    oldestCursor = null;
    hasMoreMessages = false;

    showWelcomeScreen();
    updateSessionHeaderTitle('New Session');
    refreshViewState();

    // Remove active highlight from all sidebar sessions
    document.querySelectorAll('.session-item').forEach((el) => {
      el.classList.remove('active');
    });
  }

  async function switchSession(newSessionId) {
    if (newSessionId === sessionId) return;

    sessionId = newSessionId;
    isNewSessionPending = false;
    messagesContainer.innerHTML = '';
    oldestCursor = null;
    hasMoreMessages = false;

    showChatArea();
    setStatus('thinking', 'Loading...');

    // Load conversation history for this session
    await loadConversationHistory();
    if (sessionId !== newSessionId) return; // the user moved on while history loaded

    // Work still running in this session (started earlier) isn't in history yet — show it live
    (liveRows.get(sessionId) || []).forEach((row) => messagesContainer.appendChild(row));
    scrollToBottom();
    refreshViewState();

    // Update active indicator in sidebar
    document.querySelectorAll('.session-item').forEach((el) => {
      el.classList.toggle('active', el.dataset?.sessionId === sessionId);
    });

    // Update header title from the active session item
    const activeItem = document.querySelector(`.session-item[data-session-id="${sessionId}"]`);
    const title = activeItem?.querySelector('.session-title')?.textContent || 'Chat';
    updateSessionHeaderTitle(title);
  }

  async function loadConversationHistory() {
    const historySessionId = sessionId;
    try {
      const res = await fetch(`/api/sessions/${historySessionId}/conversations?limit=10`);
      const data = await res.json();
      if (sessionId !== historySessionId) return; // switched away — don't render into another session

      if (data.conversations && data.conversations.length > 0) {
        data.conversations.forEach((msg) => renderHistoryMessage(msg));
        scrollToBottom();
      }

      oldestCursor = data.nextCursor;
      hasMoreMessages = data.hasMore;
    } catch (err) {
      console.error('Failed to load conversation history', err);
    }
  }

  async function loadOlderMessages() {
    if (!oldestCursor || isLoadingHistory) return;

    isLoadingHistory = true;

    // Show loading indicator at top
    const loader = document.createElement('div');
    loader.className = 'history-loader';
    loader.textContent = 'Loading older messages...';
    messagesContainer.prepend(loader);

    try {
      const res = await fetch(
        `/api/sessions/${sessionId}/conversations?cursor=${oldestCursor}&limit=10`
      );
      const data = await res.json();

      loader.remove();

      if (data.conversations && data.conversations.length > 0) {
        const previousHeight = messagesContainer.scrollHeight;

        // Prepend messages in chronological order (oldest first)
        data.conversations.forEach((msg) => {
          renderHistoryMessage(msg, true); // true = prepend
        });

        // Preserve scroll position
        messagesContainer.scrollTop = messagesContainer.scrollHeight - previousHeight;
      }

      oldestCursor = data.nextCursor;
      hasMoreMessages = data.hasMore;
    } catch (err) {
      loader.remove();
      console.error('Failed to load older messages', err);
    } finally {
      isLoadingHistory = false;
    }
  }

  /**
   * Renders a message from DB history using the SAME visual functions
   * as live messages, but WITHOUT streaming animation.
   */
  function renderHistoryMessage(msg, prepend = false) {
    if (msg.role === 'user') {
      appendUserMessage(msg.content, new Date(msg.createdAt), prepend);
    } else {
      const type = msg.responseType === 'error' ? 'error'
        : msg.responseType === 'system' ? 'system' : 'neurostack';
      appendAIMessage(msg.content, type, msg.metadata, false, new Date(msg.createdAt), prepend);
    }
  }

  function showWelcomeScreen() {
    if (welcomeScreen) welcomeScreen.classList.remove('hidden');
    messagesContainer.classList.remove('active');
  }

  /** Updates the header title in the chat area */
  function updateSessionHeaderTitle(title) {
    const headerTitle = document.querySelector('.chat-header .header-left h3');
    if (headerTitle) headerTitle.textContent = title;
  }

  // ═══════════════════════════════════════════════
  //  STATUS
  // ═══════════════════════════════════════════════

  function setStatus(state, text) {
    statusEl.className = 'status-badge ' + state;
    statusEl.querySelector('.status-dot') || null;
    const label = statusEl.childNodes[statusEl.childNodes.length - 1];
    if (label) label.textContent = ' ' + text;
  }

  // ═══════════════════════════════════════════════
  //  COMMANDS
  // ═══════════════════════════════════════════════

  async function fetchCommands() {
    try {
      const res = await fetch('/api/commands');
      const data = await res.json();
      availableCommands = data.commands || [];
    } catch (err) {
      console.error('Failed to fetch commands', err);
    }
  }

  // ═══════════════════════════════════════════════
  //  SEND MESSAGE
  // ═══════════════════════════════════════════════

  async function sendMessage() {
    const text = inputEl.value.trim();
    if (!text || isBusy(sessionId)) return;

    // Lazily create DB session on first message (deferred from "New Session" click)
    await ensureSession();
    const targetSession = sessionId;
    if (!targetSession || isBusy(targetSession)) return;

    // Work is tied to the session it was sent from: the user may switch to
    // another session (and start work there) while this one is still running.
    setBusy(targetSession, true);
    hideCommandPopup();
    showChatArea();

    const userRow = appendUserMessage(text);
    inputEl.value = '';
    inputEl.style.height = 'auto';

    const folder = sessionFolders.get(targetSession);
    const loopMatch = text.match(/^@AGENT_LOOP\s+([\s\S]+)/i);

    try {
      if (folder && !text.startsWith('@')) {
        // ── Folder-agent branch: a bound session's prompts run the agent in its folder ──
        // (@commands still go to the normal chat pipeline.)
        await streamFolderAgent({ targetSession, folder, prompt: text, resume: false, userRow });
      } else if (loopMatch) {
        // ── Agent loop branch: @AGENT_LOOP streams multi-iteration progress ──
        await streamAgentLoop(loopMatch[1].trim(), targetSession, userRow);
      } else {
        await sendChatMessage(text, targetSession, userRow);
      }
      // Refresh sidebar to show new/updated session title — skip auto-select
      loadSessions(true);
    } catch (err) {
      if (isViewing(targetSession)) {
        await appendAIMessage('Failed to reach the server. Please try again.', 'error');
      }
    } finally {
      setBusy(targetSession, false);
      if (isViewing(targetSession)) inputEl.focus();
    }
  }

  /** Normal conversational message (and @commands) via /api/chat. */
  async function sendChatMessage(text, targetSession, userRow) {
    const typingRow = showTypingIndicator();
    liveRows.set(targetSession, [userRow, typingRow]);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId: targetSession }),
      });
      const data = await res.json();

      removeTypingIndicator(typingRow);
      liveRows.delete(targetSession);
      // If the user moved to another session, the reply is already saved to this
      // session's history and will show when they come back.
      if (!isViewing(targetSession)) return;

      const type = data.type === 'error' ? 'error' : data.type === 'system' ? 'system' : 'neurostack';
      await appendAIMessage(data.content, type, data);
    } finally {
      removeTypingIndicator(typingRow);
      liveRows.delete(targetSession);
    }
  }

  function isViewing(targetSession) {
    return !!targetSession && sessionId === targetSession;
  }

  function isBusy(targetSession) {
    return !!targetSession && busySessions.has(targetSession);
  }

  function setBusy(targetSession, busy) {
    if (busy) {
      busySessions.add(targetSession);
    } else {
      busySessions.delete(targetSession);
      approvalSessions.delete(targetSession);
      liveRows.delete(targetSession);
    }
    refreshSessionBadges();
    if (isViewing(targetSession)) refreshViewState();
  }

  /** Syncs the status badge, folder bar and input to the session being viewed. */
  function refreshViewState() {
    if (isBusy(sessionId)) {
      setStatus('thinking', approvalSessions.has(sessionId) ? 'Waiting for your approval' : 'Working…');
    } else {
      setStatus('ready', 'Ready');
    }
    renderFolderBar();
  }

  /** Creates the DB session on first use so the exchange is saved to history. */
  async function ensureSession() {
    if (sessionId || !currentUser) return;
    try {
      const res = await fetch('/api/sessions', { method: 'POST' });
      const data = await res.json();
      if (data.session) {
        sessionId = data.session.id;
        isNewSessionPending = false;
      }
    } catch (err) {
      console.error('Failed to auto-create session', err);
    }
  }

  /** Reads a Server-Sent Events response body, calling onEvent for each JSON `data:` frame. */
  async function readSseEvents(res, onEvent) {
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
        onEvent(evt);
      }
    }
  }

  // ═══════════════════════════════════════════════
  //  FOLDER AGENT (each session bound to its own project folder)
  // ═══════════════════════════════════════════════

  /** Shows folder mode for admins (the folder agent runs commands on the server host). */
  function initFolderMode() {
    if (!currentUser || currentUser.role !== 'admin') return;
    isFolderModeEnabled = true;

    folderBtn?.classList.remove('hidden');
    document.getElementById('folder-agent-link')?.classList.remove('hidden');

    folderBtn?.addEventListener('click', openFolderPicker);
    folderClearBtn?.addEventListener('click', () => bindFolderToSession(null));
    folderResumeBtn?.addEventListener('click', resumeFolderRun);
    folderParentBtn?.addEventListener('click', () => { if (browseParent) browseFolders(browseParent); });
    document.getElementById('folder-modal-close')?.addEventListener('click', closeFolderPicker);
    document.getElementById('folder-cancel-btn')?.addEventListener('click', closeFolderPicker);
    document.getElementById('folder-select-btn')?.addEventListener('click', () => {
      if (browsePath) bindFolderToSession(browsePath);
      closeFolderPicker();
    });
    folderModal?.addEventListener('click', (e) => { if (e.target === folderModal) closeFolderPicker(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !folderModal.classList.contains('hidden')) closeFolderPicker();
    });

    // The folder used to be remembered per browser; it now lives on each session.
    try { localStorage.removeItem('neurostack.selectedFolder'); } catch { /* storage unavailable */ }
  }

  /** Saves (or clears, with null) the current session's project folder on the server. */
  async function bindFolderToSession(folder) {
    if (isBusy(sessionId)) return;
    await ensureSession();
    const targetSession = sessionId;
    if (!targetSession) return;

    try {
      const res = await fetch(`/api/sessions/${targetSession}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath: folder }),
      });
      const data = await res.json();
      if (!res.ok) {
        await appendAIMessage(data.content || 'Could not set the folder for this session.', 'error', null, false);
        return;
      }

      if (data.session?.folderPath) sessionFolders.set(targetSession, data.session.folderPath);
      else sessionFolders.delete(targetSession);

      if (isViewing(targetSession)) {
        renderFolderBar();
        inputEl.focus();
      }
      loadSessions(true);
    } catch (err) {
      await appendAIMessage('Could not reach the server to set the folder.', 'error', null, false);
    }
  }

  /** Shows the viewed session's folder (if any) above the input. */
  function renderFolderBar() {
    if (!isFolderModeEnabled) return;
    const folder = sessionId ? sessionFolders.get(sessionId) || null : null;
    const busy = isBusy(sessionId);

    folderBar.classList.toggle('hidden', !folder);
    folderBtn.classList.toggle('active', !!folder);
    folderBtn.disabled = busy;
    folderResumeBtn.disabled = busy;
    folderClearBtn.disabled = busy;
    folderBarPath.textContent = folder || '';
    folderBarPath.title = folder || '';
    inputEl.placeholder = folder
      ? `Describe what to build or fix in ${folderName(folder)} — the agent works until it is done…`
      : defaultPlaceholder;
  }

  function openFolderPicker() {
    if (isBusy(sessionId)) return;
    folderModal.classList.remove('hidden');
    browseFolders((sessionId && sessionFolders.get(sessionId)) || null);
  }

  function closeFolderPicker() {
    folderModal.classList.add('hidden');
  }

  async function browseFolders(targetPath) {
    folderCurrentPath.textContent = 'Loading…';
    folderDirList.innerHTML = '';
    try {
      const url = targetPath ? `/api/folder/browse?path=${encodeURIComponent(targetPath)}` : '/api/folder/browse';
      const res = await fetch(url);
      const data = await res.json();

      if (!res.ok) {
        // e.g. a folder that is now outside FOLDER_AGENT_ROOT — fall back to the root
        if (targetPath) return browseFolders(null);
        folderCurrentPath.textContent = data.content || 'Cannot browse folders.';
        return;
      }

      browsePath = data.current;
      browseParent = data.parent;
      folderCurrentPath.textContent = data.current;
      folderParentBtn.disabled = !data.parent;

      if (data.dirs.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'folder-dir-empty';
        empty.textContent = '(no sub-folders)';
        folderDirList.appendChild(empty);
      }
      data.dirs.forEach((dir) => {
        const item = document.createElement('li');
        item.textContent = '📁 ' + dir.name;
        item.addEventListener('click', () => browseFolders(dir.path));
        folderDirList.appendChild(item);
      });
    } catch (err) {
      folderCurrentPath.textContent = 'Failed to load folders.';
    }
  }

  /** Resumes an interrupted/paused run in the session's folder from its .neurostack/ checkpoint. */
  async function resumeFolderRun() {
    const targetSession = sessionId;
    const folder = targetSession ? sessionFolders.get(targetSession) : null;
    if (!folder || isBusy(targetSession)) return;

    setBusy(targetSession, true);
    showChatArea();
    const userRow = appendUserMessage(`📁 ${folder}\n\n⟳ Resume the interrupted run`);
    try {
      await streamFolderAgent({ targetSession, folder, prompt: null, resume: true, userRow });
      loadSessions(true);
    } catch (err) {
      if (isViewing(targetSession)) await appendAIMessage('Folder agent failed to resume. Please try again.', 'error');
    } finally {
      setBusy(targetSession, false);
    }
  }

  /**
   * Runs the folder agent in a session's folder and streams its progress into a
   * live panel in that session, including inline Allow/Deny prompts for commands
   * that need approval. The panel keeps updating while the user is in another
   * session and is re-shown on switching back. The final report is saved to the
   * session's history by the server.
   */
  async function streamFolderAgent({ targetSession, folder, prompt, resume, userRow }) {
    const row = document.createElement('div');
    row.classList.add('message-row', 'neurostack');
    row.innerHTML = `
      <div class="msg-avatar neurostack">📁</div>
      <div class="msg-content">
        <div class="msg-bubble">
          <div class="loop-header"><strong>Folder Agent</strong> <span class="loop-status">starting…</span></div>
          <div class="folder-run-path msg-time"></div>
          <div class="folder-approvals"></div>
          <ol class="loop-steps"></ol>
        </div>
      </div>`;
    row.querySelector('.folder-run-path').textContent = folder;
    messagesContainer.appendChild(row);
    liveRows.set(targetSession, [userRow, row]);
    scrollToBottom();

    const stepsEl = row.querySelector('.loop-steps');
    const statusLabel = row.querySelector('.loop-status');
    const approvalsEl = row.querySelector('.folder-approvals');
    const addStep = (label) => {
      const li = document.createElement('li');
      li.textContent = label;
      stepsEl.appendChild(li);
      if (isViewing(targetSession)) scrollToBottom();
    };
    const setApprovalPending = (pending) => {
      if (pending) approvalSessions.add(targetSession);
      else if (!approvalsEl.children.length) approvalSessions.delete(targetSession);
      refreshSessionBadges();
      if (isViewing(targetSession)) refreshViewState();
    };

    let finalEvent = null;
    let errorMessage = null;

    const res = await fetch('/api/folder/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: folder, prompt, resume, mode: folderModeSelect.value, sessionId: targetSession }),
    });

    if (!res.ok || !res.body) {
      let reason = 'Failed to start the folder agent.';
      try { reason = (await res.json()).content || reason; } catch { /* not JSON */ }
      statusLabel.textContent = 'failed to start';
      if (isViewing(targetSession)) await appendAIMessage(reason, 'error', null, false);
      return;
    }

    await readSseEvents(res, (evt) => {
      switch (evt.type) {
        case 'round':
          statusLabel.textContent = 'working';
          addStep('⚙️ ' + evt.message);
          break;
        case 'handoff':
          addStep('🔀 ' + evt.message);
          break;
        case 'approval_request':
          statusLabel.textContent = 'awaiting approval';
          showFolderApproval(evt, approvalsEl, addStep, setApprovalPending);
          setApprovalPending(true);
          break;
        case 'done':
          statusLabel.textContent = 'complete';
          addStep('🏁 ' + evt.message);
          break;
        case 'paused':
          statusLabel.textContent = 'paused';
          addStep('⏸️ ' + evt.message);
          break;
        case 'error':
          statusLabel.textContent = 'error';
          errorMessage = evt.message;
          addStep('⚠️ ' + evt.message);
          break;
        case 'result':
          finalEvent = evt;
          break;
        default:
          if (evt.message) addStep(evt.message);
      }
    });

    // Not viewing this session: the server saved the report to its history,
    // and it shows (with a sidebar refresh) when the user switches back.
    if (!isViewing(targetSession)) return;

    if (finalEvent) {
      const status = finalEvent.data?.status || 'complete';
      const handoffs = finalEvent.data?.handoffCount || 0;
      statusLabel.textContent = status;
      const note = status === 'paused' ? '\n\n_All models are rate-limited right now — use **⟳ Resume** later to continue._' : '';
      await appendAIMessage(
        `**Folder agent — ${status}** · ${handoffs} handoff(s)\n\n${finalEvent.message || ''}${note}`,
        status === 'complete' ? 'neurostack' : 'system',
        null,
        false,
      );
    } else {
      await appendAIMessage(`Folder agent failed: ${errorMessage || 'the run ended unexpectedly.'}`, 'error', null, false);
    }
  }

  /** Inline Allow/Deny card for a command the agent wants to run. */
  function showFolderApproval(evt, container, addStep, setApprovalPending) {
    const box = document.createElement('div');
    box.className = 'folder-approval';

    const reason = document.createElement('div');
    reason.textContent = '⚠️ ' + evt.message;
    const command = document.createElement('code');
    command.textContent = evt.data?.command || '';

    const actions = document.createElement('div');
    actions.className = 'folder-approval-actions';
    const allowBtn = document.createElement('button');
    allowBtn.className = 'folder-select-btn';
    allowBtn.textContent = 'Allow';
    const denyBtn = document.createElement('button');
    denyBtn.className = 'folder-bar-btn';
    denyBtn.textContent = 'Deny';

    const decide = async (approved) => {
      allowBtn.disabled = denyBtn.disabled = true;
      try {
        await fetch('/api/folder/approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ approvalId: evt.data?.approvalId, approved }),
        });
      } catch { /* the server auto-denies after a timeout */ }
      box.remove();
      setApprovalPending(false);
      addStep(`${approved ? '✅ Allowed' : '⛔ Denied'}: ${evt.data?.command || ''}`);
    };
    allowBtn.addEventListener('click', () => decide(true));
    denyBtn.addEventListener('click', () => decide(false));

    actions.append(allowBtn, denyBtn);
    box.append(reason, command, actions);
    container.appendChild(box);
    scrollToBottom();
  }

  // ═══════════════════════════════════════════════
  //  AGENT LOOP (SSE streaming)
  // ═══════════════════════════════════════════════

  /**
   * Runs an autonomous agent loop and renders live progress from the SSE stream.
   * Each event updates a single progress panel; the final result appends a
   * summary and (if changes were staged) a review button.
   */
  async function streamAgentLoop(requirement, targetSession, userRow) {
    // Progress panel
    const row = document.createElement('div');
    row.classList.add('message-row', 'neurostack');
    row.innerHTML = `
      <div class="msg-avatar neurostack">🔁</div>
      <div class="msg-content">
        <div class="msg-bubble">
          <div class="loop-header"><strong>Agent Loop</strong> <span class="loop-status">starting…</span></div>
          <ol class="loop-steps"></ol>
        </div>
      </div>`;
    messagesContainer.appendChild(row);
    liveRows.set(targetSession, [userRow, row]);
    scrollToBottom();

    const stepsEl = row.querySelector('.loop-steps');
    const statusLabel = row.querySelector('.loop-status');
    const addStep = (label) => {
      const li = document.createElement('li');
      li.textContent = label;
      stepsEl.appendChild(li);
      if (isViewing(targetSession)) scrollToBottom();
      return li;
    };

    const res = await fetch('/api/loop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requirement, sessionId: targetSession, autoApprove: true }),
    });

    if (!res.ok || !res.body) {
      statusLabel.textContent = 'failed to start';
      return;
    }

    let finalResult = null;
    await readSseEvents(res, (evt) => {
      if (evt.type === 'result') {
        finalResult = evt.result;
        return;
      }
      renderLoopEvent(evt, addStep, statusLabel);
    });

    // Final summary
    if (finalResult && isViewing(targetSession)) {
      statusLabel.textContent = finalResult.stopReason;
      const met = finalResult.metCriteria?.length || 0;
      const total = met + (finalResult.unmetCriteria?.length || 0);
      await appendAIMessage(
        `**Loop finished — ${finalResult.stopReason}.** Criteria met: ${met}/${total}.\n\n${finalResult.summary || ''}`,
        'neurostack',
        finalResult.changeSetId ? { changeSetId: finalResult.changeSetId } : null,
        false,
      );
    }
  }

  function renderLoopEvent(evt, addStep, statusLabel) {
    switch (evt.type) {
      case 'plan':
        statusLabel.textContent = 'planning';
        addStep('📋 Plan created');
        break;
      case 'iteration':
        statusLabel.textContent = `iteration ${evt.iteration || ''}`.trim();
        addStep(`⚙️ ${evt.message}`);
        break;
      case 'node':
        if (evt.node === 'verify') addStep(`🔍 ${evt.message}`);
        else if (evt.node === 'review') addStep(`🧐 ${evt.message}`);
        else if (evt.node === 'finalize') addStep(`🏁 ${evt.message}`);
        break;
      case 'verdict':
        addStep(`⚖️ ${evt.message}`);
        break;
      case 'awaiting_approval':
        statusLabel.textContent = 'awaiting approval';
        addStep('⏸️ Awaiting plan approval');
        break;
      case 'error':
        statusLabel.textContent = 'error';
        addStep(`⚠️ ${evt.message}`);
        break;
      default:
        break;
    }
  }

  // ═══════════════════════════════════════════════
  //  MESSAGE RENDERING
  // ═══════════════════════════════════════════════

  function showChatArea() {
    if (welcomeScreen) welcomeScreen.classList.add('hidden');
    messagesContainer.classList.add('active');
  }

  /** Create a user message row */
  function appendUserMessage(text, timestamp = null, prepend = false) {
    const row = document.createElement('div');
    row.classList.add('message-row', 'user');

    const time = formatTime(timestamp || new Date());

    row.innerHTML = `
      <div class="msg-avatar user">👤</div>
      <div class="msg-content">
        <div class="msg-bubble">${escapeHtml(text)}</div>
        <div class="msg-time">${time}</div>
      </div>
    `;

    if (prepend) {
      messagesContainer.prepend(row);
    } else {
      messagesContainer.appendChild(row);
      scrollToBottom();
    }
    return row;
  }

  /** Create a NeuroStack / system / error message with optional streaming effect */
  async function appendAIMessage(text, type = 'neurostack', rawData = null, stream = true, timestamp = null, prepend = false) {
    const row = document.createElement('div');
    row.classList.add('message-row', type);

    const time = formatTime(timestamp || new Date());
    const avatarEmoji = type === 'error' ? '⚠️' : type === 'system' ? 'ℹ️' : '⚡';
    const avatarClass = type === 'neurostack' ? 'neurostack' : type;

    row.innerHTML = `
      <div class="msg-avatar ${avatarClass}">${avatarEmoji}</div>
      <div class="msg-content">
        <div class="msg-bubble"></div>
        <div class="message-actions">
          <button class="msg-action-btn" data-action="copy" title="Copy response">📋</button>
          <button class="msg-action-btn" data-action="thumbsup" title="Good response">👍</button>
          <button class="msg-action-btn" data-action="thumbsdown" title="Bad response">👎</button>
        </div>
        <div class="msg-time">${time}</div>
      </div>
    `;

    const bubble = row.querySelector('.msg-bubble');

    if (prepend) {
      messagesContainer.prepend(row);
    } else {
      messagesContainer.appendChild(row);
    }

    // Set up action buttons
    row.querySelectorAll('.msg-action-btn').forEach((btn) => {
      btn.addEventListener('click', () => handleMessageAction(btn, text));
    });

    // Streaming effect for live NeuroStack messages only (not history replay)
    if (type === 'neurostack' && stream && !prepend) {
      await streamContent(bubble, text);
    } else {
      bubble.innerHTML = renderMarkdown(text);
    }

    // Post-process code blocks
    processCodeBlocks(bubble);

    // Add review button if there's a changeset ID
    if (rawData && rawData.changeSetId) {
      appendReviewButton(row, rawData);
    }

    if (!prepend) scrollToBottom();
  }

  function appendReviewButton(row, data) {
    const btn = document.createElement('button');
    btn.className = 'review-btn';
    const numFiles = data.changesSummary ? (data.changesSummary.filesAdded + data.changesSummary.filesModified + data.changesSummary.filesDeleted) : 0;
    const countText = numFiles > 0 ? ` (${numFiles} files)` : '';
    btn.innerHTML = `<span class="qa-icon">🔍</span> Review Changes${countText}`;
    btn.addEventListener('click', () => {
      if (window.openReviewPanel) {
        window.openReviewPanel(data.changeSetId);
      }
    });
    row.querySelector('.msg-content').appendChild(btn);
  }

  /** Streaming typewriter effect: reveals content word-by-word with live markdown rendering */
  function streamContent(bubble, text) {
    return new Promise((resolve) => {
      const words = text.split(/(\s+)/); // Split preserving whitespace
      let current = '';
      let wordIdx = 0;
      const CHUNK_SIZE = 3; // Words per frame
      const FRAME_DELAY = 20; // ms between frames

      bubble.classList.add('streaming-cursor');

      function renderNextChunk() {
        if (wordIdx >= words.length) {
          bubble.classList.remove('streaming-cursor');
          bubble.innerHTML = renderMarkdown(text);
          processCodeBlocks(bubble);
          scrollToBottom();
          resolve();
          return;
        }

        // Append next chunk of words
        const end = Math.min(wordIdx + CHUNK_SIZE, words.length);
        for (let i = wordIdx; i < end; i++) {
          current += words[i];
        }
        wordIdx = end;

        // Live markdown render
        bubble.innerHTML = renderMarkdown(current);
        scrollToBottom();

        requestAnimationFrame(() => {
          setTimeout(renderNextChunk, FRAME_DELAY);
        });
      }

      renderNextChunk();
    });
  }

  /**
   * Render markdown with marked.js, sanitized with DOMPurify.
   * Model output is untrusted — it can contain raw HTML (prompt injection),
   * so anything that cannot be sanitized falls back to escaped text.
   */
  function renderMarkdown(text) {
    if (window.marked && window.DOMPurify) {
      try {
        return window.DOMPurify.sanitize(window.marked.parse(text));
      } catch (e) {
        console.error('Markdown parse error', e);
      }
    }
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  /** Wrap <pre><code> blocks with header + copy button */
  function processCodeBlocks(container) {
    container.querySelectorAll('pre code').forEach((codeEl) => {
      const pre = codeEl.parentElement;
      // Skip if already processed
      if (pre.parentElement?.classList.contains('code-block-wrapper')) return;

      // Detect language
      const classes = codeEl.className || '';
      const langMatch = classes.match(/language-(\w+)/);
      const lang = langMatch ? langMatch[1] : '';

      // Create wrapper
      const wrapper = document.createElement('div');
      wrapper.classList.add('code-block-wrapper');

      // Header with language + copy button
      const header = document.createElement('div');
      header.classList.add('code-block-header');
      header.innerHTML = `
        <span class="code-lang">${lang || 'code'}</span>
        <button class="copy-code-btn" title="Copy code">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          Copy
        </button>
      `;

      // Copy handler
      header.querySelector('.copy-code-btn').addEventListener('click', function () {
        const codeText = codeEl.textContent;
        navigator.clipboard.writeText(codeText).then(() => {
          this.classList.add('copied');
          this.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
            Copied!
          `;
          setTimeout(() => {
            this.classList.remove('copied');
            this.innerHTML = `
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
              Copy
            `;
          }, 2000);
        });
      });

      // Highlight if not already
      if (window.hljs && !codeEl.dataset.highlighted) {
        window.hljs.highlightElement(codeEl);
      }

      // Reconstruct DOM
      pre.parentNode.insertBefore(wrapper, pre);
      wrapper.appendChild(header);
      wrapper.appendChild(pre);
    });
  }

  // ── Message Actions ──
  function handleMessageAction(btn, messageText) {
    const action = btn.dataset.action;

    switch (action) {
      case 'copy':
        navigator.clipboard.writeText(messageText).then(() => {
          showToast('Response copied to clipboard');
        });
        break;

      case 'thumbsup':
        btn.classList.toggle('active');
        // Deactivate opposite
        btn.parentElement.querySelector('[data-action="thumbsdown"]')?.classList.remove('active');
        showToast('Thanks for the feedback!');
        break;

      case 'thumbsdown':
        btn.classList.toggle('active');
        btn.parentElement.querySelector('[data-action="thumbsup"]')?.classList.remove('active');
        showToast('Thanks for the feedback!');
        break;
    }
  }

  // ═══════════════════════════════════════════════
  //  TYPING INDICATOR
  // ═══════════════════════════════════════════════

  function showTypingIndicator() {
    const row = document.createElement('div');
    row.classList.add('message-row', 'neurostack', 'typing-row');

    row.innerHTML = `
      <div class="msg-avatar neurostack">⚡</div>
      <div class="msg-content">
        <div class="msg-bubble typing-indicator">
          <span></span><span></span><span></span>
        </div>
      </div>
    `;

    messagesContainer.appendChild(row);
    scrollToBottom();
    return row;
  }

  function removeTypingIndicator(row) {
    if (row?.parentNode) row.parentNode.removeChild(row);
  }

  // ═══════════════════════════════════════════════
  //  TOAST NOTIFICATION
  // ═══════════════════════════════════════════════

  function showToast(message) {
    // Remove existing toast
    document.querySelector('.toast')?.remove();

    const toast = document.createElement('div');
    toast.classList.add('toast');
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  // ═══════════════════════════════════════════════
  //  COMMAND POPUP (@ autocomplete)
  // ═══════════════════════════════════════════════

  function showCommandPopup(filter) {
    const query = filter.toLowerCase();
    const filtered = availableCommands.filter(
      (cmd) =>
        cmd.name.toLowerCase().includes(query) ||
        cmd.trigger.toLowerCase().includes(query)
    );

    if (filtered.length === 0) {
      hideCommandPopup();
      return;
    }

    commandPopup.innerHTML = '<div class="command-popup-title">Commands</div>';
    selectedCommandIdx = -1;

    filtered.forEach((cmd, idx) => {
      const item = document.createElement('div');
      item.classList.add('command-item');
      item.dataset.index = idx;

      const trigger = document.createElement('span');
      trigger.className = 'command-trigger';
      trigger.textContent = cmd.trigger;

      const desc = document.createElement('span');
      desc.className = 'command-desc';
      desc.textContent = cmd.description || 'No description available';

      item.append(trigger, desc);
      item.addEventListener('click', () => insertCommand(cmd));
      item.addEventListener('mouseenter', () => {
        selectedCommandIdx = idx;
        highlightCommandItem();
      });
      commandPopup.appendChild(item);
    });

    commandPopup.classList.add('visible');
  }

  function hideCommandPopup() {
    commandPopup.classList.remove('visible');
    commandPopup.innerHTML = '';
    selectedCommandIdx = -1;
  }

  function highlightCommandItem() {
    commandPopup.querySelectorAll('.command-item').forEach((el, i) => {
      el.classList.toggle('selected', i === selectedCommandIdx);
    });
  }

  function insertCommand(cmd) {
    const cursorPos = inputEl.selectionStart;
    const text = inputEl.value;
    const atIdx = text.lastIndexOf('@', cursorPos - 1);

    if (atIdx !== -1) {
      inputEl.value = text.slice(0, atIdx) + cmd.trigger + ' ' + text.slice(cursorPos);
      inputEl.focus();
      const newPos = atIdx + cmd.trigger.length + 1;
      inputEl.setSelectionRange(newPos, newPos);
    }

    hideCommandPopup();
  }

  function getFilteredCommands() {
    const cursorPos = inputEl.selectionStart;
    const beforeCursor = inputEl.value.slice(0, cursorPos);
    const atMatch = beforeCursor.match(/@(\w*)$/);
    if (!atMatch) return [];
    const query = atMatch[1].toLowerCase();
    return availableCommands.filter(
      (cmd) =>
        cmd.name.toLowerCase().includes(query) ||
        cmd.trigger.toLowerCase().includes(query)
    );
  }

  // ═══════════════════════════════════════════════
  //  INPUT EVENT LISTENERS
  // ═══════════════════════════════════════════════

  inputEl.addEventListener('input', () => {
    const cursorPos = inputEl.selectionStart;
    const beforeCursor = inputEl.value.slice(0, cursorPos);
    const atMatch = beforeCursor.match(/@(\w*)$/);

    if (atMatch) {
      showCommandPopup(atMatch[1]);
    } else {
      hideCommandPopup();
    }
  });

  inputEl.addEventListener('keydown', (e) => {
    const isPopupVisible = commandPopup.classList.contains('visible');

    if (isPopupVisible) {
      const items = commandPopup.querySelectorAll('.command-item');

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedCommandIdx = Math.min(selectedCommandIdx + 1, items.length - 1);
        highlightCommandItem();
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedCommandIdx = Math.max(selectedCommandIdx - 1, 0);
        highlightCommandItem();
        return;
      }

      if (e.key === 'Enter' || e.key === 'Tab') {
        if (selectedCommandIdx >= 0) {
          e.preventDefault();
          const filtered = getFilteredCommands();
          if (filtered[selectedCommandIdx]) {
            insertCommand(filtered[selectedCommandIdx]);
          }
          return;
        }
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        hideCommandPopup();
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  sendBtn.addEventListener('click', sendMessage);

  // ═══════════════════════════════════════════════
  //  UTILITIES
  // ═══════════════════════════════════════════════

  function scrollToBottom() {
    requestAnimationFrame(() => {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    });
  }

  function escapeHtml(str) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return str.replace(/[&<>"']/g, (c) => map[c]);
  }

  function formatTime(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
});
