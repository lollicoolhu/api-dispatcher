const MAX_LOGS = 1000;
let accessLogs = [];

// 添加访问日志
function addLog(req, found, mappingResponse = null, reqBody = null, proxyReqHeaders = null, matchedFolder = null) {
  // 跳过来自管理页面的内部请求
  const referer = req.headers['referer'] || '';
  if (referer.includes('/admin')) return;
  
  const now = new Date();
  const time = now.toLocaleTimeString('zh-CN', { hour12: false }) + '.' + String(now.getMilliseconds()).padStart(3, '0');
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  const urlPath = req.url.replace(/\/$/, '').split('?')[0];
  const urlObj = new URL(req.url, 'http://localhost');
  const query = {};
  urlObj.searchParams.forEach((v, k) => query[k] = v);
  
  // 解析 referer 获取父请求路径
  let parentPath = null;
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      parentPath = refererUrl.pathname;
    } catch {}
  }
  
  accessLogs.unshift({
    time,
    path: urlPath,
    ip,
    found,
    method: req.method,
    fullUrl: req.url,
    query,
    headers: req.headers,
    mappingResponse,
    body: reqBody,
    proxyReqHeaders,
    parentPath,
    matchedFolder
  });
  
  if (accessLogs.length > MAX_LOGS) accessLogs.pop();
}

// 获取所有日志
function getLogs() {
  return accessLogs;
}

// 清空日志
function clearLogs() {
  accessLogs = [];
}

module.exports = {
  addLog,
  getLogs,
  clearLogs
};
