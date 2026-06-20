/**
 * 🌲 树洞 API 服务器
 * GitHub Issues 做数据库，Node.js 原生 HTTPS 请求调 API
 * 修复：Windows 中文编码问题
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO = 'lovexie04/treehole';
const PORT = 3000;

// ========== 获取 GitHub Token ==========
function getToken() {
  try {
    return execSync('gh auth token', { encoding: 'utf8' }).trim();
  } catch { return null; }
}

// ========== Node.js 原生 GitHub API 请求 ==========
function ghApi(method, endpoint, bodyObj) {
  return new Promise((resolve) => {
    const token = getToken();
    if (!token) { resolve(null); return; }

    const body = bodyObj ? JSON.stringify(bodyObj) : null;
    const url = new URL(`https://api.github.com/${endpoint}`);

    const options = {
      hostname: 'api.github.com',
      path: url.pathname + url.search,
      method: method,
      rejectUnauthorized: false,
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'treehole-server',
        'Content-Type': 'application/json; charset=utf-8'
      }
    };

    if (body) {
      options.headers['Content-Length'] = Buffer.byteLength(body, 'utf8');
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });

    req.on('error', () => resolve(null));
    if (body) req.write(body);
    req.end();
  });
}

// ========== 业务函数 ==========

async function getPosts() {
  const raw = await ghApi('GET', `repos/${REPO}/issues`);
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

async function addPost(content) {
  const title = content.split('\n')[0].slice(0, 72) || '树洞投稿';
  const result = await ghApi('POST', `repos/${REPO}/issues`, {
    title: title, body: content
  });
  return result && result.number ? { id: result.number, time: result.created_at, url: result.html_url } : null;
}

async function getComments(issueNumber) {
  const raw = await ghApi('GET', `repos/${REPO}/issues/${issueNumber}/comments`);
  if (!raw) return [];
  const comments = Array.isArray(raw) ? raw : [raw];
  return comments.map(c => ({
    id: c.id,
    content: (c.body || '').trim(),
    time: c.created_at,
    author: c.user?.login || '匿名'
  }));
}

async function addComment(issueNumber, content) {
  const result = await ghApi('POST', `repos/${REPO}/issues/${issueNumber}/comments`, {
    body: content
  });
  return result && result.id ? { id: result.id, time: result.created_at } : null;
}

// ========== HTTP Server ==========

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
};

function serveFile(res, filePath) {
  const ext = path.extname(filePath);
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  function readBody() {
    return new Promise(resolve => {
      let b = '';
      req.on('data', c => b += c);
      req.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(null); } });
    });
  }

  // ===== Routes =====

  if (req.method === 'GET' && req.url === '/api/posts') {
    getPosts().then(posts => json(res, 200, { success: true, data: posts }));
    return;
  }

  if (req.method === 'POST' && req.url === '/api/posts') {
    readBody().then(async body => {
      if (!body || !body.content || !body.content.trim()) return json(res, 400, { success: false, error: '内容不能为空' });
      if (body.content.length > 500) return json(res, 400, { success: false, error: '内容不能超过500字' });
      const result = await addPost(body.content.trim());
      if (result) json(res, 201, { success: true, data: result });
      else json(res, 500, { success: false, error: '发布失败' });
    });
    return;
  }

  const commentMatch = req.url.match(/^\/api\/posts\/(\d+)\/comments$/);
  if (commentMatch) {
    const issueId = commentMatch[1];
    if (req.method === 'GET') {
      getComments(issueId).then(comments => json(res, 200, { success: true, data: comments }));
      return;
    }
    if (req.method === 'POST') {
      readBody().then(async body => {
        if (!body || !body.content || !body.content.trim()) return json(res, 400, { success: false, error: '内容不能为空' });
        if (body.content.length > 200) return json(res, 400, { success: false, error: '回复不能超过200字' });
        const result = await addComment(issueId, body.content.trim());
        if (result) json(res, 201, { success: true, data: result });
        else json(res, 500, { success: false, error: '回复失败' });
      });
      return;
    }
  }

  // 静态文件
  if (req.url === '/' || req.url === '') serveFile(res, path.join(__dirname, 'index.html'));
  else serveFile(res, path.join(__dirname, req.url));
});

server.listen(PORT, () => {
  console.log(`\n  🌲 树洞服务器已启动！`);
  console.log(`  ───────────────────────────`);
  console.log(`  本地访问: http://localhost:${PORT}`);
  console.log(`  ───────────────────────────`);
  console.log(`  按 Ctrl+C 停止服务器\n`);
});
