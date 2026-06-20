/**
 * 🌲 树洞 API 服务器
 * 
 * 用 GitHub CLI (gh) 作为后端，GitHub Issues 作为数据库
 * 运行：node server.js
 * 然后打开 http://localhost:3000
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO = 'lovexie04/treehole';
const PORT = 3000;

// ========== GitHub Issues API (通过gh CLI) ==========

function gh(...args) {
  const cmd = `gh api ${args.map(a => `"${a}"`).join(' ')}`;
  try {
    return JSON.parse(execSync(cmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }));
  } catch (e) {
    console.error('gh error:', e.stderr?.slice(0, 200));
    return null;
  }
}

function getPosts() {
  // 获取所有Issues作为帖子
  const issues = gh(
    `repos/${REPO}/issues`,
    '--jq', `.[] | { id: .number, content: (.title + "\n" + .body), time: .created_at, likes: .reactions."+1", comments: .comments, url: .html_url }`
  );
  if (!issues) return [];
  // 过滤掉标题带 [ADMIN] 的系统消息
  return Array.isArray(issues) ? issues.filter(i => !i.content.startsWith('[ADMIN]')) : [];
}

function addPost(content) {
  const title = content.split('\n')[0].slice(0, 72) || '树洞投稿';
  const body = content;
  const result = gh(
    `repos/${REPO}/issues`,
    '-X', 'POST',
    '--field', `title=${title}`,
    '--field', `body=${body}`,
    '--jq', '{ id: .number, time: .created_at, url: .html_url }'
  );
  return result;
}

function likePost(id) {
  // GitHub API: 给Issue添加❤️反应
  const result = gh(
    `repos/${REPO}/issues/${id}/reactions`,
    '-X', 'POST',
    '--field', 'content=+1',
    '--jq', '.id'
  );
  return !!result;
}

// ========== HTTP Server ==========

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

function serveFile(res, filePath) {
  const ext = path.extname(filePath);
  const mime = MIME[ext] || 'application/octet-stream';
  
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mime, 'Access-Control-Allow-Origin': '*' });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ===== API 路由 =====
  if (req.method === 'GET' && req.url === '/api/posts') {
    const posts = getPosts();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: posts }));
    return;
  }

  if (req.method === 'POST' && req.url === '/api/posts') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { content } = JSON.parse(body);
        if (!content || content.trim().length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: '内容不能为空' }));
          return;
        }
        if (content.length > 500) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: '内容不能超过500字' }));
          return;
        }
        const result = addPost(content);
        if (result) {
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, data: result }));
        } else {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: '发布失败' }));
        }
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: '无效的请求格式' }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url.startsWith('/api/like/')) {
    const id = req.url.split('/').pop();
    if (id) {
      const result = likePost(id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: result }));
      return;
    }
  }

  // ===== 静态文件 =====
  if (req.url === '/' || req.url === '') {
    serveFile(res, path.join(__dirname, 'index.html'));
  } else {
    serveFile(res, path.join(__dirname, req.url));
  }
});

server.listen(PORT, () => {
  console.log(`\n  🌲 树洞服务器已启动！`);
  console.log(`  ───────────────────────────`);
  console.log(`  本地访问: http://localhost:${PORT}`);
  console.log(`  GitHub:   https://github.com/${REPO}`);
  console.log(`  Pages:    https://lovexie04.github.io/treehole/`);
  console.log(`  ───────────────────────────`);
  console.log(`  按 Ctrl+C 停止服务器\n`);
});
