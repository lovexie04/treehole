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
const { execSync, spawnSync } = require('child_process');

const REPO = 'lovexie04/treehole';
const PORT = 3000;

// ========== GitHub Issues API (通过gh CLI) ==========

/**
 * 执行 gh api 命令
 * 对于POST请求，用 stdin 传 JSON body 避免编码问题
 */
function gh(method, endpoint, jsonBody) {
  const args = ['api', endpoint, '-X', method, '--jq', '.'];
  if (jsonBody) {
    // 用 stdin 传 JSON
    const result = spawnSync('gh', args, {
      input: JSON.stringify(jsonBody),
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
    if (result.status !== 0) {
      console.error('gh error:', result.stderr?.slice(0, 200));
      return null;
    }
    try { return JSON.parse(result.stdout); } catch { return result.stdout; }
  } else {
    // GET 请求直接执行
    const cmd = `gh api "${endpoint}" --jq "."`;
    try {
      return JSON.parse(execSync(cmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }));
    } catch (e) {
      console.error('gh error:', e.stderr?.slice(0, 200));
      return null;
    }
  }
}

function getPosts() {
  const raw = gh('GET', `repos/${REPO}/issues`);
  if (!raw) return [];
  const issues = Array.isArray(raw) ? raw : [raw];
  return issues.map(issue => ({
    id: issue.number,
    content: (issue.body || issue.title || '').trim(),
    time: issue.created_at,
    likes: issue.reactions ? issue.reactions['+1'] || 0 : 0,
    comments: issue.comments || 0,
    url: issue.html_url
  }));
}

function addPost(content) {
  const title = content.split('\n')[0].slice(0, 72) || '树洞投稿';
  const result = gh('POST', `repos/${REPO}/issues`, {
    title: title,
    body: content
  });
  return result ? { id: result.number, time: result.created_at, url: result.html_url } : null;
}

function getComments(issueNumber) {
  const raw = gh('GET', `repos/${REPO}/issues/${issueNumber}/comments`);
  if (!raw) return [];
  const comments = Array.isArray(raw) ? raw : [raw];
  return comments.map(c => ({
    id: c.id,
    content: (c.body || '').trim(),
    time: c.created_at,
    author: c.user?.login || '匿名'
  }));
}

function addComment(issueNumber, content) {
  const result = gh('POST', `repos/${REPO}/issues/${issueNumber}/comments`, {
    body: content
  });
  return result ? { id: result.id, time: result.created_at } : null;
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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 解析请求体
  function readBody() {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { resolve(null); }
      });
    });
  }

  // ===== API 路由 =====

  // GET /api/posts - 获取所有帖子
  if (req.method === 'GET' && req.url === '/api/posts') {
    const posts = getPosts();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: posts }));
    return;
  }

  // POST /api/posts - 发布帖子
  if (req.method === 'POST' && req.url === '/api/posts') {
    readBody().then(async (body) => {
      if (!body || !body.content || !body.content.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: '内容不能为空' }));
        return;
      }
      if (body.content.length > 500) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: '内容不能超过500字' }));
        return;
      }
      const result = addPost(body.content.trim());
      if (result) {
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: result }));
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: '发布失败，请稍后再试' }));
      }
    });
    return;
  }

  // GET/POST /api/posts/:id/comments - 查看/添加评论
  const commentMatch = req.url.match(/^\/api\/posts\/(\d+)\/comments$/);
  if (commentMatch) {
    const issueId = commentMatch[1];

    if (req.method === 'GET') {
      const comments = getComments(issueId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: comments }));
      return;
    }

    if (req.method === 'POST') {
      readBody().then(async (body) => {
        if (!body || !body.content || !body.content.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: '内容不能为空' }));
          return;
        }
        if (body.content.length > 200) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: '回复不能超过200字' }));
          return;
        }
        const result = addComment(issueId, body.content.trim());
        if (result) {
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, data: result }));
        } else {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: '回复失败，请稍后再试' }));
        }
      });
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
  console.log(`  ───────────────────────────`);
  console.log(`  按 Ctrl+C 停止服务器\n`);
});
