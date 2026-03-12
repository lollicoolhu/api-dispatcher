const fs = require('fs');
const path = require('path');
const os = require('os');

// 重写 Set-Cookie header
function rewriteSetCookie(cookies, reqHost, cookieRewrite) {
  if (!cookies || !cookieRewrite) return cookies;
  
  const currentDomain = (reqHost || 'localhost').split(':')[0];
  
  const rewrite = (cookie) => {
    let result = cookie;
    // 移除 Secure
    result = result.replace(/;\s*Secure/gi, '');
    // 替换或添加 Domain
    if (/;\s*Domain=/i.test(result)) {
      result = result.replace(/;\s*Domain=[^;]*/gi, '; Domain=' + currentDomain);
    } else {
      const idx = result.indexOf(';');
      if (idx > 0) {
        result = result.substring(0, idx) + '; Domain=' + currentDomain + result.substring(idx);
      } else {
        result = result + '; Domain=' + currentDomain;
      }
    }
    // 替换或添加 SameSite
    if (/;\s*SameSite=/i.test(result)) {
      result = result.replace(/;\s*SameSite=[^;]*/gi, '; SameSite=Lax');
    } else {
      result = result + '; SameSite=Lax';
    }
    // 替换或添加 Path
    if (!/;\s*Path=/i.test(result)) {
      result = result + '; Path=/';
    }
    return result;
  };
  
  if (Array.isArray(cookies)) {
    return cookies.map(rewrite);
  }
  return rewrite(cookies);
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
function getServerAddresses(port, httpsPort) {
  const interfaces = os.networkInterfaces();
  const addresses = ['http://localhost:' + port];
  
  // 添加 HTTPS 地址（如果启用）
  if (httpsPort) {
    addresses.push('https://localhost:' + httpsPort);
  }
  
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push('http://' + iface.address + ':' + port);
        if (httpsPort) {
          addresses.push('https://' + iface.address + ':' + httpsPort);
        }
      }
    }
  }
  return addresses;
}

module.exports = {
  rewriteSetCookie,
  getAllFiles,
  getServerAddresses
};
