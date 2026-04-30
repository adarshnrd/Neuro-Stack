document.addEventListener('DOMContentLoaded', () => {
  const reviewPanel = document.getElementById('review-panel');
  const reviewCloseBtn = document.getElementById('review-close-btn');
  const reviewFileTree = document.getElementById('review-file-tree');
  const diffContent = document.getElementById('diff-content');
  const toggleUnified = document.getElementById('toggle-unified');
  const toggleSplit = document.getElementById('toggle-split');
  
  const acceptBtn = document.getElementById('review-accept-btn');
  const rejectBtn = document.getElementById('review-reject-btn');
  const reviseBtn = document.getElementById('review-revise-btn');
  const feedbackInput = document.getElementById('review-feedback-input');

  let currentChangeSet = null;
  let currentFileIndex = 0;
  let viewMode = 'unified'; // 'unified' | 'split'

  window.openReviewPanel = async (changeSetId) => {
    try {
      const res = await fetch(`/api/review/${changeSetId}`);
      if (!res.ok) throw new Error('Failed to fetch changeset');
      currentChangeSet = await res.json();
      currentFileIndex = 0;
      renderFileTree();
      renderDiff();
      reviewPanel.classList.add('open');
    } catch (error) {
      console.error(error);
      alert('Could not load review changes.');
    }
  };

  reviewCloseBtn.addEventListener('click', closePanel);
  
  function closePanel() {
    reviewPanel.classList.remove('open');
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && reviewPanel.classList.contains('open')) closePanel();
  });

  function renderFileTree() {
    reviewFileTree.innerHTML = '';
    currentChangeSet.files.forEach((file, index) => {
      const el = document.createElement('div');
      el.className = `file-tree-item ${index === currentFileIndex ? 'active' : ''}`;
      
      const dot = document.createElement('div');
      dot.className = `file-status-dot ${file.status.toLowerCase()}`;
      
      const name = document.createElement('span');
      name.textContent = file.filePath;
      name.title = file.filePath;

      el.appendChild(dot);
      el.appendChild(name);
      
      el.addEventListener('click', () => {
        currentFileIndex = index;
        renderFileTree();
        renderDiff();
      });
      
      reviewFileTree.appendChild(el);
    });
  }

  toggleUnified.addEventListener('click', () => {
    viewMode = 'unified';
    toggleUnified.classList.add('active');
    toggleSplit.classList.remove('active');
    renderDiff();
  });

  toggleSplit.addEventListener('click', () => {
    viewMode = 'split';
    toggleSplit.classList.add('active');
    toggleUnified.classList.remove('active');
    renderDiff();
  });

  function renderDiff() {
    diffContent.innerHTML = '';
    const file = currentChangeSet.files[currentFileIndex];
    if (!file) return;

    if (viewMode === 'unified') {
      file.diffLines.forEach((line, lineIdx) => {
        const row = document.createElement('div');
        row.className = `diff-line ${line.type}`;
        
        const oldGut = document.createElement('div');
        oldGut.className = 'diff-gutter old-line';
        oldGut.textContent = line.oldLineNumber || '';
        
        const newGut = document.createElement('div');
        newGut.className = 'diff-gutter new-line';
        newGut.textContent = line.newLineNumber || '';

        const code = document.createElement('div');
        code.className = 'diff-code';
        code.textContent = line.content || ' ';

        if (window.hljs) {
          const match = file.filePath.match(/\.(\w+)$/);
          if (match && window.hljs.getLanguage(match[1])) {
            code.innerHTML = window.hljs.highlight(code.textContent, { language: match[1] }).value;
          }
        }

        row.appendChild(oldGut);
        row.appendChild(newGut);
        row.appendChild(code);

        // Allow clicking on a line to add a comment
        row.addEventListener('dblclick', () => showCommentBox(row, lineIdx));

        diffContent.appendChild(row);
        
        // Check if there are comments for this line
        const comments = currentChangeSet.comments.filter(c => c.fileIndex === currentFileIndex && c.lineNumber === lineIdx);
        if (comments.length > 0) {
          comments.forEach(c => {
            const commentRow = document.createElement('div');
            commentRow.className = 'diff-comment-row';
            commentRow.innerHTML = `<strong>${c.author}</strong> <small>${new Date(c.timestamp).toLocaleString()}</small><p>${c.content}</p>`;
            diffContent.appendChild(commentRow);
          });
        }
      });
    } else {
      // Split view implementation for side-by-side
      file.diffLines.forEach((line, lineIdx) => {
        const row = document.createElement('div');
        row.className = 'diff-split';

        const left = document.createElement('div');
        left.className = `diff-split-half ${line.type === 'add' ? 'context' : line.type}`;
        left.innerHTML = `<div class="diff-gutter old-line">${line.oldLineNumber || ''}</div>
                          <div class="diff-code">${line.type === 'add' ? ' ' : escapeHtml(line.content)}</div>`;

        const right = document.createElement('div');
        right.className = `diff-split-half ${line.type === 'remove' ? 'context' : line.type}`;
        right.innerHTML = `<div class="diff-gutter new-line">${line.newLineNumber || ''}</div>
                           <div class="diff-code">${line.type === 'remove' ? ' ' : escapeHtml(line.content)}</div>`;

        if (window.hljs) {
           const match = file.filePath.match(/\.(\w+)$/);
           const lang = match ? match[1] : '';
           if (lang && window.hljs.getLanguage(lang)) {
             if (line.type !== 'add' && line.content) left.querySelector('.diff-code').innerHTML = window.hljs.highlight(line.content, { language: lang }).value;
             if (line.type !== 'remove' && line.content) right.querySelector('.diff-code').innerHTML = window.hljs.highlight(line.content, { language: lang }).value;
           }
        }

        row.appendChild(left);
        row.appendChild(right);
        
        row.addEventListener('dblclick', () => showCommentBox(row, lineIdx));
        diffContent.appendChild(row);
        
        // Append comments if any
        const comments = currentChangeSet.comments.filter(c => c.fileIndex === currentFileIndex && c.lineNumber === lineIdx);
        if (comments.length > 0) {
          comments.forEach(c => {
            const commentRow = document.createElement('div');
            commentRow.className = 'diff-comment-row';
            commentRow.innerHTML = `<strong>${c.author}</strong> <small>${new Date(c.timestamp).toLocaleString()}</small><p>${c.content}</p>`;
            diffContent.appendChild(commentRow);
          });
        }
      });
    }
  }

  function showCommentBox(rowElement, lineIdx) {
    if (rowElement.nextSibling && rowElement.nextSibling.classList?.contains('diff-comment-box')) return;
    
    const box = document.createElement('div');
    box.className = 'diff-comment-box diff-comment-row';
    box.innerHTML = `
      <textarea class="diff-comment-input" placeholder="Type a comment..."></textarea>
      <div style="text-align: right; margin-top: 8px;">
        <button class="btn-cancel" style="padding: 4px 8px; margin-right: 8px;">Cancel</button>
        <button class="btn-primary" style="padding: 4px 8px;">Save</button>
      </div>
    `;

    box.querySelector('.btn-cancel').addEventListener('click', () => box.remove());
    box.querySelector('.btn-primary').addEventListener('click', async () => {
      const content = box.querySelector('textarea').value;
      if (!content) return;
      try {
        const res = await fetch(`/api/review/${currentChangeSet.changeSetId}/comment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileIndex: currentFileIndex, lineNumber: lineIdx, content })
        });
        if (res.ok) {
          const data = await res.json();
          currentChangeSet.comments.push(data.comment);
          renderDiff();
        }
      } catch (err) {
        alert('Failed to save comment');
      }
    });

    rowElement.parentNode.insertBefore(box, rowElement.nextSibling);
    box.querySelector('textarea').focus();
  }

  function escapeHtml(str) {
    if (!str) return ' ';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return str.replace(/[&<>"']/g, (c) => map[c]);
  }

  acceptBtn.addEventListener('click', async () => {
    try {
      const res = await fetch(`/api/review/${currentChangeSet.changeSetId}/accept`, { method: 'POST' });
      if (res.ok) {
        closePanel();
        alert('Changes accepted and applied.');
      }
    } catch (err) {
      alert('Error accepting changes');
    }
  });

  rejectBtn.addEventListener('click', async () => {
    try {
      const res = await fetch(`/api/review/${currentChangeSet.changeSetId}/reject`, { method: 'POST' });
      if (res.ok) {
        closePanel();
        alert('Changes rejected.');
      }
    } catch (err) {
      alert('Error rejecting changes');
    }
  });

  reviseBtn.addEventListener('click', async () => {
    const feedback = feedbackInput.value;
    if (!feedback) {
      alert('Please provide feedback first.');
      return;
    }
    try {
      const res = await fetch(`/api/review/${currentChangeSet.changeSetId}/revise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback })
      });
      if (res.ok) {
        closePanel();
        alert('Revision requested. NeuroStack is processing...');
      }
    } catch (err) {
      alert('Error requesting revision');
    }
  });

});
