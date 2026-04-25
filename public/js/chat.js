/**
 * Project Jarvis — Chat Client
 * Premium chat UI with markdown rendering, streaming effect,
 * code copy buttons, message actions, and @ command autocomplete.
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

  // ── State ──
  let sessionId          = null;
  let availableCommands  = [];
  let selectedCommandIdx = -1;
  let isSending          = false;

  // ── Configure marked.js ──
  if (window.marked) {
    window.marked.setOptions({
      breaks: true,
      gfm: true,
      highlight: (code, lang) => {
        if (window.hljs && lang && window.hljs.getLanguage(lang)) {
          try { return window.hljs.highlight(code, { language: lang }).value; }
          catch (_) { /* fall through */ }
        }
        if (window.hljs) {
          try { return window.hljs.highlightAuto(code).value; }
          catch (_) { /* fall through */ }
        }
        return code;
      },
    });
  }

  // ── Initialize ──
  setStatus('ready', 'Ready');
  fetchCommands();

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

    isSending = true;
    hideCommandPopup();
    showChatArea();

    // Render user message
    appendUserMessage(text);

    inputEl.value = '';
    inputEl.style.height = 'auto';

    // Show typing
    const typingRow = showTypingIndicator();

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

      const type = data.type === 'error' ? 'error' : data.type === 'system' ? 'system' : 'jarvis';
      await appendAIMessage(data.content, type, data);

      setStatus('ready', 'Ready');
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
  //  MESSAGE RENDERING
  // ═══════════════════════════════════════════════

  function showChatArea() {
    if (welcomeScreen) welcomeScreen.classList.add('hidden');
    messagesContainer.classList.add('active');
  }

  /** Create a user message row */
  function appendUserMessage(text) {
    const row = document.createElement('div');
    row.classList.add('message-row', 'user');

    const time = formatTime(new Date());

    row.innerHTML = `
      <div class="msg-avatar user">👤</div>
      <div class="msg-content">
        <div class="msg-bubble">${escapeHtml(text)}</div>
        <div class="msg-time">${time}</div>
      </div>
    `;

    messagesContainer.appendChild(row);
    scrollToBottom();
  }

  /** Create a Jarvis / system / error message with streaming effect */
  async function appendAIMessage(text, type = 'jarvis', rawData = null) {
    const row = document.createElement('div');
    row.classList.add('message-row', type);

    const time = formatTime(new Date());
    const avatarEmoji = type === 'error' ? '⚠️' : type === 'system' ? 'ℹ️' : '⚡';
    const avatarClass = type === 'jarvis' ? 'jarvis' : type;

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
    messagesContainer.appendChild(row);

    // Set up action buttons
    row.querySelectorAll('.msg-action-btn').forEach((btn) => {
      btn.addEventListener('click', () => handleMessageAction(btn, text));
    });

    // Streaming effect for Jarvis messages
    if (type === 'jarvis') {
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

    scrollToBottom();
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

  /** Render markdown with marked.js or fallback to escaped HTML */
  function renderMarkdown(text) {
    if (window.marked) {
      try {
        return window.marked.parse(text);
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
    row.classList.add('message-row', 'jarvis', 'typing-row');

    row.innerHTML = `
      <div class="msg-avatar jarvis">⚡</div>
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
      item.innerHTML = `
        <span class="command-trigger">${cmd.trigger}</span>
        <span class="command-desc">${cmd.description || 'No description available'}</span>
      `;
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
