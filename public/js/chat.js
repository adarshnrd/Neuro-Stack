document.addEventListener('DOMContentLoaded', () => {
  const messagesContainer = document.getElementById('chat-messages');
  const inputEl = document.getElementById('chat-input');
  const sendBtn = document.getElementById('send-btn');
  const statusEl = document.getElementById('connection-status');
  
  const ws = new WebSocket(`ws://${window.location.host}`);
  
  ws.onopen = () => {
    statusEl.textContent = 'Connected';
    statusEl.style.color = '#10b981'; // green
  };
  
  ws.onclose = () => {
    statusEl.textContent = 'Disconnected';
    statusEl.style.color = '#ef4444'; // red
  };
  
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      appendMessage(data.content, data.type === 'system' ? 'jarvis' : 'jarvis');
    } catch {
      appendMessage(event.data, 'jarvis');
    }
  };
  
  function appendMessage(text, sender) {
    const div = document.createElement('div');
    div.classList.add('message', sender);
    div.textContent = text; // Just text content for now (will add marked.js later)
    messagesContainer.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
  
  function sendMessage() {
    const text = inputEl.value.trim();
    if (!text) return;
    
    appendMessage(text, 'user');
    ws.send(text);
    inputEl.value = '';
  }
  
  sendBtn.addEventListener('click', sendMessage);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
});
