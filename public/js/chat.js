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
  let isSending            = false;
  let isNewSessionPending  = false;

  // ── Pagination state ──
  let oldestCursor       = null;
  let hasMoreMessages    = false;
  let isLoadingHistory   = false;

  // ── Auth state ──
  let currentUser        = null;

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
      renderSessionList(sessions);

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
      item.addEventListener('click', () => switchSession(s.id));
      listEl.appendChild(item);
    });
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

    setStatus('ready', 'Ready');

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
    try {
      const res = await fetch(`/api/sessions/${sessionId}/conversations?limit=10`);
      const data = await res.json();

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
    if (!text || isSending) return;

    // Lazily create DB session on first message (deferred from "New Session" click)
    if (!sessionId && currentUser) {
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

    isSending = true;
    hideCommandPopup();
    showChatArea();

    // Render user message
    appendUserMessage(text);

    inputEl.value = '';
    inputEl.style.height = 'auto';

    // Show typing
    const typingRow = showTypingIndicator();

    // ── Agent loop branch: @AGENT_LOOP streams multi-iteration progress ──
    const loopMatch = text.match(/^@AGENT_LOOP\s+([\s\S]+)/i);
    if (loopMatch) {
      removeTypingIndicator(typingRow);
      try {
        await streamAgentLoop(loopMatch[1].trim());
        loadSessions(true);
      } catch (err) {
        await appendAIMessage('Agent loop failed to start. Please try again.', 'error');
      } finally {
        isSending = false;
        inputEl.focus();
      }
      return;
    }

    try {
      setStatus('thinking', 'Thinking...');

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId }),
      });

      const data = await res.json();
      if (data.sessionId) sessionId = data.sessionId;

      removeTypingIndicator(typingRow);

      const type = data.type === 'error' ? 'error' : data.type === 'system' ? 'system' : 'neurostack';
      await appendAIMessage(data.content, type, data);

      setStatus('ready', 'Ready');

      // Refresh sidebar to show new/updated session title — skip auto-select
      loadSessions(true);
    } catch (err) {
      removeTypingIndicator(typingRow);
      await appendAIMessage('Failed to reach the server. Please try again.', 'error');
      setStatus('error', 'Error');
    } finally {
      isSending = false;
      inputEl.focus();
    }
  }

  // ═══════════════════════════════════════════════
  //  AGENT LOOP (SSE streaming)
  // ═══════════════════════════════════════════════

  /**
   * Runs an autonomous agent loop and renders live progress from the SSE stream.
   * Each event updates a single progress panel; the final result appends a
   * summary and (if changes were staged) a review button.
   */
  async function streamAgentLoop(requirement) {
    setStatus('thinking', 'Running agent loop…');

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
    scrollToBottom();

    const stepsEl = row.querySelector('.loop-steps');
    const statusLabel = row.querySelector('.loop-status');
    const addStep = (label) => {
      const li = document.createElement('li');
      li.textContent = label;
      stepsEl.appendChild(li);
      scrollToBottom();
      return li;
    };

    const res = await fetch('/api/loop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requirement, sessionId, autoApprove: true }),
    });

    if (!res.ok || !res.body) {
      statusLabel.textContent = 'failed to start';
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalResult = null;

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

        if (evt.type === 'result') {
          finalResult = evt.result;
          continue;
        }
        renderLoopEvent(evt, addStep, statusLabel);
      }
    }

    // Final summary
    if (finalResult) {
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
    setStatus('ready', 'Ready');
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
