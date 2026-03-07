const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 3000;
let baseFolder = process.argv[2] || 'mock';
let accessLogs = [];
const MAX_LOGS = 1000;

const DATA_FILE = path.join(__dirname, '.mock-server-data.json');
let tempOverrides = {};  // { path: { content, enabled, priority } }
let urlMappings = {};    // { path: { target, enabled, priority } }
let globalServer = { url: '', enabled: false, priority: 100 };

// 加载持久化数据
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      // 兼容旧格式
      const oldOverrides = data.tempOverrides || {};
      const oldMappings = data.urlMappings || data.proxyMappings || {};
      // 转换旧格式到新格式
      tempOverrides = {};
      for (const [k, v] of Object.entries(oldOverrides)) {
        if (typeof v === 'string') {
          tempOverrides[k] = { content: v, enabled: true, priority: 1 };
        } else {
          tempOverrides[k] = v;
        }
      }
      urlMappings = {};
      for (const [k, v] of Object.entries(oldMappings)) {
        if (typeof v === 'string') {
          urlMappings[k] = { target: v, enabled: true, priority: 1 };
        } else {
          urlMappings[k] = v;
        }
      }
      globalServer = data.globalServer || { url: '', enabled: false, priority: 100 };
      console.log('Loaded ' + Object.keys(tempOverrides).length + ' overrides, ' + Object.keys(urlMappings).length + ' mappings');
    }
  } catch (e) { console.error('Failed to load data:', e.message); }
}

// 保存持久化数据
function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ tempOverrides, urlMappings, globalServer }, null, 2));
  } catch (e) { console.error('Failed to save data:', e.message); }
}

loadData();

// 添加访问日志
function addLog(req, found, mappingResponse = null, reqBody = null) {
  // 跳过来自管理页面的内部请求（通过referer判断）
  const referer = req.headers['referer'] || '';
  if (referer.includes('/admin')) return;
  
  const now = new Date();
  const time = now.toLocaleString('zh-CN', { hour12: false });
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  const urlPath = req.url.replace(/\/$/, '').split('?')[0];
  const urlObj = new URL(req.url, 'http://localhost');
  const query = {};
  urlObj.searchParams.forEach((v, k) => query[k] = v);
  accessLogs.unshift({ time, path: urlPath, ip, found, method: req.method, fullUrl: req.url, query, headers: req.headers, mappingResponse, body: reqBody });
  if (accessLogs.length > MAX_LOGS) accessLogs.pop();
}

// 递归获取所有JSON文件
function getAllFiles(dir, base = '') {
  let results = [];
  try {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const relPath = base ? base + '/' + item : item;
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        results = results.concat(getAllFiles(fullPath, relPath));
      } else if (item.endsWith('.json')) {
        const apiPath = '/' + relPath.replace(/\.json$/, '');
        const content = fs.readFileSync(fullPath, 'utf8');
        results.push({ path: apiPath, content });
      }
    }
  } catch (e) {}
  return results;
}

// 获取服务器地址
function getServerAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = ['http://localhost:' + PORT];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push('http://' + iface.address + ':' + PORT);
      }
    }
  }
  return addresses;
}


// HTTP服务器
const server = http.createServer((req, res) => {
  // 静态文件服务
  if (req.url === '/admin' || req.url === '/admin/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8'));
    return;
  }
  if (req.url === '/admin.css') {
    res.setHeader('Content-Type', 'text/css; charset=utf-8');
    res.end(fs.readFileSync(path.join(__dirname, 'admin.css'), 'utf8'));
    return;
  }
  if (req.url === '/admin.js') {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.end(fs.readFileSync(path.join(__dirname, 'admin.js'), 'utf8'));
    return;
  }

  // API: 日志
  if (req.url === '/admin/logs' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(accessLogs));
    return;
  }
  if (req.url === '/admin/logs' && req.method === 'DELETE') {
    accessLogs = [];
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // API: 文件列表
  if (req.url.startsWith('/admin/files') && req.method === 'GET') {
    const urlObj = new URL(req.url, 'http://localhost');
    const folder = urlObj.searchParams.get('folder');
    if (!folder) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: '请指定文件夹' })); return; }
    if (!fs.existsSync(folder)) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: '文件夹不存在: ' + folder })); return; }
    const files = getAllFiles(folder);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ files }));
    return;
  }

  // API: 保存文件
  if (req.url === '/admin/file/save' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { folder, path: apiPath, content } = JSON.parse(body);
        const filePath = path.join(folder, apiPath + '.json');
        fs.writeFileSync(filePath, content);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true }));
      } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  // API: 创建文件
  if (req.url === '/admin/file/create' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { path: apiPath, content } = JSON.parse(body);
        const filePath = path.join(baseFolder, apiPath + '.json');
        const dir = path.dirname(filePath);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, content);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true }));
      } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  // API: 删除文件
  if (req.url === '/admin/file/delete' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { path: apiPath } = JSON.parse(body);
        const filePath = path.join(baseFolder, apiPath + '.json');
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: true }));
        } else {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: false, error: '文件不存在' }));
        }
      } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  // API: 临时覆盖
  if (req.url === '/admin/overrides' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(tempOverrides));
    return;
  }
  if (req.url === '/admin/overrides' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { path: p, content, enabled, priority } = JSON.parse(body);
        if (tempOverrides[p]) {
          // 更新现有
          if (content !== undefined) tempOverrides[p].content = content;
          if (enabled !== undefined) tempOverrides[p].enabled = enabled;
          if (priority !== undefined) tempOverrides[p].priority = priority;
        } else {
          // 新建
          tempOverrides[p] = { content: content || '{}', enabled: enabled !== false, priority: priority ?? 1 };
        }
        saveData();
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true }));
      } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }
  if (req.url === '/admin/overrides' && req.method === 'DELETE') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { path: p } = JSON.parse(body);
        delete tempOverrides[p];
        saveData();
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true }));
      } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  // API: URL映射
  if (req.url === '/admin/mappings' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(urlMappings));
    return;
  }
  if (req.url === '/admin/mappings' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { path: p, target, enabled, priority } = JSON.parse(body);
        if (urlMappings[p]) {
          if (target !== undefined) urlMappings[p].target = target;
          if (enabled !== undefined) urlMappings[p].enabled = enabled;
          if (priority !== undefined) urlMappings[p].priority = priority;
        } else {
          urlMappings[p] = { target: target || '', enabled: enabled !== false, priority: priority ?? 1 };
        }
        saveData();
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true }));
      } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }
  if (req.url === '/admin/mappings' && req.method === 'DELETE') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { path: p } = JSON.parse(body);
        delete urlMappings[p];
        saveData();
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true }));
      } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  // API: 全局服务器
  if (req.url === '/admin/global-server' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(globalServer));
    return;
  }
  if (req.url === '/admin/global-server' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (data.url !== undefined) globalServer.url = data.url;
        if (data.enabled !== undefined) globalServer.enabled = data.enabled;
        if (data.priority !== undefined) globalServer.priority = data.priority;
        saveData();
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true }));
      } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }


  // API: 测试映射
  if (req.url === '/admin/test-mapping' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { path: apiPath, target } = JSON.parse(body);
        // 去掉目标地址末尾的斜杠，避免双斜杠
        const targetBase = target.replace(/\/+$/, '');
        const targetUrl = targetBase + apiPath;
        const startTime = Date.now();
        const protocol = targetUrl.startsWith('https') ? https : http;
        protocol.get(targetUrl, (proxyRes) => {
          let data = '';
          proxyRes.on('data', chunk => data += chunk);
          proxyRes.on('end', () => {
            const headers = {};
            Object.keys(proxyRes.headers).forEach(k => headers[k] = proxyRes.headers[k]);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              status: proxyRes.statusCode,
              url: targetUrl,
              time: Date.now() - startTime,
              size: data.length,
              headers,
              body: data
            }));
          });
        }).on('error', (e) => {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ status: 0, url: targetUrl, time: 0, size: 0, headers: {}, body: 'Error: ' + e.message }));
        });
      } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  // API: HAR保存
  if (req.url === '/admin/har/save' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const files = JSON.parse(body);
        let count = 0;
        for (const [filePath, content] of Object.entries(files)) {
          const fullPath = path.join(__dirname, filePath);
          const dir = path.dirname(fullPath);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(fullPath, content);
          count++;
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true, count }));
      } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  // API: 文件夹
  if (req.url === '/admin/folder' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ folder: baseFolder }));
    return;
  }
  if (req.url === '/admin/folder' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { folder } = JSON.parse(body);
        if (!fs.existsSync(folder)) {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: false, error: '文件夹不存在' }));
          return;
        }
        baseFolder = folder;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true, folder: baseFolder }));
      } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  // API: 服务器信息
  if (req.url === '/admin/server-info' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ addresses: getServerAddresses() }));
    return;
  }

  // ========== 主请求处理 ==========
  const urlPath = req.url.replace(/\/$/, '').split('?')[0];
  const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  const filePath = path.join(baseFolder, urlPath + '.json');
  const fileExists = fs.existsSync(filePath);

  // 解析请求体
  let reqBody = '';
  req.on('data', chunk => reqBody += chunk);
  req.on('end', () => {
    handleRequest(req, res, urlPath, queryString, filePath, fileExists, reqBody);
  });
});

function handleRequest(req, res, urlPath, queryString, filePath, fileExists, reqBody) {
  // 收集所有可用的响应源及其优先级
  const sources = [];
  
  // 1. 临时覆盖 (优先级由用户设置，默认1)
  const override = tempOverrides[urlPath];
  if (override && override.enabled) {
    sources.push({ type: 'override', priority: override.priority ?? 1, data: override });
  }
  
  // 2. 精确URL映射 (优先级由用户设置，默认1)
  const exactMapping = urlMappings[urlPath];
  if (exactMapping && exactMapping.enabled) {
    sources.push({ type: 'exactMapping', priority: exactMapping.priority ?? 1, data: exactMapping });
  }
  
  // 3. 本地文件 (优先级0)
  if (fileExists) {
    sources.push({ type: 'localFile', priority: 0, data: filePath });
  }
  
  // 4. 通配符URL映射 (优先级由用户设置，默认1)
  for (const [pattern, mapping] of Object.entries(urlMappings)) {
    if (pattern.endsWith('*') && mapping.enabled) {
      const prefix = pattern.slice(0, -1);
      if (urlPath.startsWith(prefix)) {
        sources.push({ type: 'wildcardMapping', priority: mapping.priority ?? 1, data: mapping, pattern });
        break;
      }
    }
  }
  
  // 5. 全局服务器 (优先级由用户设置，默认100)
  if (globalServer.enabled && globalServer.url) {
    sources.push({ type: 'globalServer', priority: globalServer.priority ?? 100, data: globalServer });
  }
  
  // 按优先级排序（数字越大优先级越高）
  sources.sort((a, b) => b.priority - a.priority);
  
  // 选择优先级最高的源
  const selected = sources[0];
  
  if (!selected) {
    // 无可用源，返回404
    addLog(req, false, null, reqBody);
    const notFoundPath = path.join(__dirname, '404.json');
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(notFoundPath)) {
      res.end(fs.readFileSync(notFoundPath, 'utf8'));
    } else {
      res.end(JSON.stringify({ error: 'Not Found', path: urlPath }));
    }
    return;
  }
  
  // 根据选中的源返回响应
  if (selected.type === 'override') {
    addLog(req, true, null, reqBody);
    res.setHeader('Content-Type', 'application/json');
    res.end(selected.data.content);
    return;
  }
  
  if (selected.type === 'localFile') {
    addLog(req, true, null, reqBody);
    res.setHeader('Content-Type', 'application/json');
    res.end(fs.readFileSync(selected.data, 'utf8'));
    return;
  }
  
  if (selected.type === 'exactMapping' || selected.type === 'wildcardMapping' || selected.type === 'globalServer') {
    const targetBase = (selected.data.target || selected.data.url).replace(/\/+$/, '');
    const targetUrl = targetBase + urlPath + queryString;
    const startTime = Date.now();
    const protocol = targetUrl.startsWith('https') ? https : http;
    protocol.get(targetUrl, (proxyRes) => {
      let data = '';
      proxyRes.on('data', chunk => data += chunk);
      proxyRes.on('end', () => {
        const headers = {};
        Object.keys(proxyRes.headers).forEach(k => headers[k] = proxyRes.headers[k]);
        const mappingResponse = {
          status: proxyRes.statusCode,
          url: targetUrl,
          time: Date.now() - startTime,
          size: data.length,
          headers,
          body: data,
          sourceType: selected.type
        };
        addLog(req, 'mapping', mappingResponse, reqBody);
        Object.keys(proxyRes.headers).forEach(k => {
          if (k !== 'transfer-encoding') res.setHeader(k, proxyRes.headers[k]);
        });
        res.statusCode = proxyRes.statusCode;
        res.end(data);
      });
    }).on('error', (e) => {
      addLog(req, 'mapping', { status: 0, url: targetUrl, time: 0, size: 0, headers: {}, body: 'Error: ' + e.message, sourceType: selected.type }, reqBody);
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Mapping request failed: ' + e.message }));
    });
    return;
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('Mock server running at http://0.0.0.0:' + PORT);
  console.log('Admin panel: http://localhost:' + PORT + '/admin');
  console.log('Serving files from: ' + baseFolder);
});
