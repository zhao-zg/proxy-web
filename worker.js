/**
 * Cloudflare Worker 反向代理服务
 * 功能：将 aaa-bb-com.yourdomain.com 的请求代理到 aaa.bb.com
 * 当访问 proxy.yourdomain.com 时显示前端页面
 */

// 配置常量
const CONFIG = {
  REQUEST_TIMEOUT: 30000, // 30秒超时
  MAX_REDIRECTS: 5,
  CORS_MAX_AGE: '86400',
  ALLOWED_METHODS: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
  BLOCKED_HEADERS: [
    'cf-connecting-ip',
    'cf-ipcountry', 
    'cf-ray',
    'cf-visitor',
    'x-forwarded-proto',
    'x-forwarded-for',
    'x-real-ip'
  ]
};

// 主事件监听器
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

/**
 * 处理请求的主函数
 * @param {Request} request - 原始请求对象
 * @returns {Promise<Response>} - 处理后的响应
 */
async function handleRequest(request) {
  try {
    // 解析请求URL
    const url = new URL(request.url);
    const hostname = url.hostname;
    const hostParts = hostname.split('.');
    
    // 检查是否为前端页面入口
    if (hostParts[0] === 'proxy' || hostParts[0] === 'proxy--') {
      return handleProxyPage(request);
    }
    
    const subdomain = extractSubdomain(hostname);
    
    // 验证子域名
    if (!subdomain) {
      return createErrorResponse('Invalid subdomain format', 400);
    }
    
    // 验证请求方法
    if (!CONFIG.ALLOWED_METHODS.includes(request.method)) {
      return createErrorResponse('Method not allowed', 405);
    }
    
    // 处理 OPTIONS 预检请求
    if (request.method === 'OPTIONS') {
      return handleOptions(request);
    }
    
    // 构建目标URL
    const targetUrl = buildTargetUrl(subdomain, url);
    
    // 执行代理请求
    return await proxyRequest(request, targetUrl);
    
  } catch (error) {
    console.error('Request handling error:', error);
    return createErrorResponse(error.message, 500);
  }
}

/**
 * 处理前端页面请求
 * @param {Request} request - 原始请求对象
 * @returns {Promise<Response>} - 前端页面响应
 */
function handleProxyPage(request) {
  const url = new URL(request.url);
  
  // 处理API请求
  if (url.pathname === '/api/generate') {
    return handleGenerateApi(request);
  }
  
  // 返回前端页面
  // @ts-ignore
  return new Response(getProxyPageHTML(url.hostname), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600'
    }
  });
}

/**
 * 处理生成代理链接的API请求
 * @param {Request} request - 原始请求对象
 * @returns {Promise<Response>} - API响应
 */
async function handleGenerateApi(request) {
  if (request.method !== 'POST') {
    return createErrorResponse('Method not allowed', 405);
  }
  
  try {
    const body = await request.json();
    const targetUrl = body.url;
    
    if (!targetUrl) {
      return createErrorResponse('URL is required', 400);
    }
    
    // 验证URL格式
    let parsedUrl;
    try {
      parsedUrl = new URL(targetUrl);
    } catch (e) {
      return createErrorResponse('Invalid URL format', 400);
    }
    
    // 只支持HTTP和HTTPS
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return createErrorResponse('Only HTTP and HTTPS URLs are supported', 400);
    }
    
    // 转换域名为代理格式
    const proxySubdomain = convertUrlToSubdomain(parsedUrl.hostname);
    const originalUrl = new URL(request.url);
    const proxyDomain = originalUrl.hostname.split('.').slice(1).join('.');
    
    const proxyUrl = `https://${proxySubdomain}.${proxyDomain}${parsedUrl.pathname}${parsedUrl.search}`;
    
    return new Response(JSON.stringify({
      success: true,
      originalUrl: targetUrl,
      proxyUrl: proxyUrl
    }), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      }
    });
    
  } catch (error) {
    return createErrorResponse('Invalid request body', 400);
  }
}

/**
 * 生成前端页面HTML
 * @param {string} hostname - 当前主机名
 * @returns {string} - HTML内容
 */
function getProxyPageHTML(hostname) {
  const domain = hostname.split('.').slice(1).join('.');
  
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>网站代理服务</title>
    <!-- 网页图标 - 使用 Base64 编码的 SVG -->
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGRlZnM+CjxsaW5lYXJHcmFkaWVudCBpZD0iZ3JhZGllbnQiIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjEwMCUiPgo8c3RvcCBvZmZzZXQ9IjAlIiBzdHlsZT0ic3RvcC1jb2xvcjojNjY3ZWVhO3N0b3Atb3BhY2l0eToxIiAvPgo8c3RvcCBvZmZzZXQ9IjEwMCUiIHN0eWxlPSJzdG9wLWNvbG9yOiM3NjRiYTI7c3RvcC1vcGFjaXR5OjEiIC8+CjwvbGluZWFyR3JhZGllbnQ+CjwvZGVmcz4KPGNpcmNsZSBjeD0iMTYiIGN5PSIxNiIgcj0iMTUiIGZpbGw9InVybCgjZ3JhZGllbnQpIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiLz4KPHN2ZyB4PSI4IiB5PSI4IiB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0id2hpdGUiPgo8cGF0aCBkPSJNMTIgMmwtMy4wOSAzLjA5TDEwIDZIMy41MUMzIDYgMyA2LjUgMyA3djEwYzAgLjUuNTEgMSAxIDFoNi41bC0xLjA5IDEuMDlMMTIgMjJsNi01LjUtNi01LjV6bTAtMi44M0wxNS4xNyAySDEydi0uODN6Ii8+Cjwvc3ZnPgo8L3N2Zz4K">
    
    <!-- 备用图标格式 -->
    <link rel="apple-touch-icon" sizes="180x180" href="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTgwIiBoZWlnaHQ9IjE4MCIgdmlld0JveD0iMCAwIDE4MCAxODAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxkZWZzPgo8bGluZWFyR3JhZGllbnQgaWQ9ImdyYWRpZW50IiB4MT0iMCUiIHkxPSIwJSIgeDI9IjEwMCUiIHkyPSIxMDAlIj4KPHN0b3Agb2Zmc2V0PSIwJSIgc3R5bGU9InN0b3AtY29sb3I6IzY2N2VlYTtzdG9wLW9wYWNpdHk6MSIgLz4KPHN0b3Agb2Zmc2V0PSIxMDAlIiBzdHlsZT0ic3RvcC1jb2xvcjojNzY0YmEyO3N0b3Atb3BhY2l0eToxIiAvPgo8L2xpbmVhckdyYWRpZW50Pgo8L2RlZnM+CjxyZWN0IHdpZHRoPSIxODAiIGhlaWdodD0iMTgwIiByeD0iMjAiIGZpbGw9InVybCgjZ3JhZGllbnQpIi8+Cjx0ZXh0IHg9IjkwIiB5PSIxMTAiIGZvbnQtZmFtaWx5PSJBcmlhbCwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSI4MCIgZm9udC13ZWlnaHQ9ImJvbGQiIGZpbGw9IndoaXRlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj7wn4yQPC90ZXh0Pgo8L3N2Zz4K">
    
    <!-- 32x32 图标 -->
    <link rel="icon" type="image/png" sizes="32x32" href="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGRlZnM+CjxsaW5lYXJHcmFkaWVudCBpZD0iZ3JhZGllbnQiIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjEwMCUiPgo8c3RvcCBvZmZzZXQ9IjAlIiBzdHlsZT0ic3RvcC1jb2xvcjojNjY3ZWVhO3N0b3Atb3BhY2l0eToxIiAvPgo8c3RvcCBvZmZzZXQ9IjEwMCUiIHN0eWxlPSJzdG9wLWNvbG9yOiM3NjRiYTI7c3RvcC1vcGFjaXR5OjEiIC8+CjwvbGluZWFyR3JhZGllbnQ+CjwvZGVmcz4KPHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iNCIgZmlsbD0idXJsKCNncmFkaWVudCkiLz4KPHN2ZyB4PSI4IiB5PSI4IiB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0id2hpdGUiPgo8cGF0aCBkPSJNMTIgMmwtMy4wOSAzLjA5TDEwIDZIMy41MUMzIDYgMyA2LjUgMyA3djEwYzAgLjUuNTEgMSAxIDFoNi41bC0xLjA5IDEuMDlMMTIgMjJsNi01LjUtNi01LjV6bTAtMi44M0wxNS4xNyAySDEydi0uODN6Ii8+Cjwvc3ZnPgo8L3N2Zz4K">
    
    <!-- 16x16 图标 -->
    <link rel="icon" type="image/png" sizes="16x16" href="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGRlZnM+CjxsaW5lYXJHcmFkaWVudCBpZD0iZ3JhZGllbnQiIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjEwMCUiPgo8c3RvcCBvZmZzZXQ9IjAlIiBzdHlsZT0ic3RvcC1jb2xvcjojNjY3ZWVhO3N0b3Atb3BhY2l0eToxIiAvPgo8c3RvcCBvZmZzZXQ9IjEwMCUiIHN0eWxlPSJzdG9wLWNvbG9yOiM3NjRiYTI7c3RvcC1vcGFjaXR5OjEiIC8+CjwvbGluZWFyR3JhZGllbnQ+CjwvZGVmcz4KPHJlY3Qgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiByeD0iMiIgZmlsbD0idXJsKCNncmFkaWVudCkiLz4KPHN2ZyB4PSI0IiB5PSI0IiB3aWR0aD0iOCIgaGVpZ2h0PSI4IiB2aWV3Qm94PSIwIDAgMjQgMjQiIGZpbGw9IndoaXRlIj4KPHBhdGggZD0iTTEyIDJsLTMuMDkgMy4wOUwxMCA2SDMuNTFDMyA2IDMgNi41IDMgN3YxMGMwIC41LjUxIDEgMSAxaDYuNWwtMS4wOSAxLjA5TDEyIDIybDYtNS41LTYtNS41em0wLTIuODNMMTUuMTcgMkgxMnYtLjgzeiIvPgo8L3N2Zz4KPC9zdmc+Cg==">

    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        
        .container {
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            padding: 40px;
            max-width: 600px;
            width: 100%;
        }
        
        .header {
            text-align: center;
            margin-bottom: 40px;
        }
        
        .header h1 {
            color: #333;
            font-size: 2.5rem;
            margin-bottom: 10px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }
        
        .header p {
            color: #666;
            font-size: 1.1rem;
            line-height: 1.6;
        }
        
        .form-group {
            margin-bottom: 30px;
        }
        
        .form-group label {
            display: block;
            margin-bottom: 10px;
            color: #333;
            font-weight: 600;
            font-size: 1.1rem;
        }
        
        .input-container {
            position: relative;
        }
        
        .form-group input {
            width: 100%;
            padding: 15px 20px;
            border: 2px solid #e1e5e9;
            border-radius: 12px;
            font-size: 1rem;
            transition: all 0.3s ease;
            background: #f8f9fa;
        }
        
        .form-group input:focus {
            outline: none;
            border-color: #667eea;
            background: white;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }
        
        .btn {
            width: 100%;
            padding: 15px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 12px;
            font-size: 1.1rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(102, 126, 234, 0.3);
        }
        
        .btn:active {
            transform: translateY(0);
        }
        
        .btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }
        
        .result {
            margin-top: 30px;
            padding: 20px;
            background: #f8f9fa;
            border-radius: 12px;
            border-left: 4px solid #667eea;
            display: none;
        }
        
        .result.show {
            display: block;
            animation: slideIn 0.3s ease;
        }
        
        .result h3 {
            color: #333;
            margin-bottom: 15px;
            font-size: 1.2rem;
        }
        
        .result-url {
            background: white;
            padding: 15px;
            border-radius: 8px;
            border: 1px solid #e1e5e9;
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            font-size: 0.9rem;
            word-break: break-all;
            margin-bottom: 15px;
            position: relative;
        }
        
        /* 按钮容器样式 */
        .button-group {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
        }
        
        .action-btn {
            flex: 1;
            min-width: 120px;
            padding: 12px 20px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 0.95rem;
            font-weight: 600;
            transition: all 0.3s ease;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }
        
        .copy-btn {
            background: #28a745;
            color: white;
        }
        
        .copy-btn:hover {
            background: #218838;
            transform: translateY(-1px);
        }
        
        .copy-btn.copied {
            background: #17a2b8;
        }
        
        .visit-btn {
            background: linear-gradient(135deg, #fd7e14 0%, #e83e8c 100%);
            color: white;
        }
        
        .visit-btn:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(232, 62, 140, 0.3);
        }
        
        .error {
            margin-top: 20px;
            padding: 15px;
            background: #f8d7da;
            color: #721c24;
            border-radius: 8px;
            border-left: 4px solid #dc3545;
            display: none;
        }
        
        .error.show {
            display: block;
            animation: slideIn 0.3s ease;
        }
        
        .loading {
            display: none;
            text-align: center;
            margin-top: 20px;
        }
        
        .loading.show {
            display: block;
        }
        
        .spinner {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 3px solid #f3f3f3;
            border-top: 3px solid #667eea;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin-right: 10px;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        @keyframes slideIn {
            from {
                opacity: 0;
                transform: translateY(-10px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        
        .examples {
            margin-top: 30px;
            padding: 20px;
            background: #e8f4fd;
            border-radius: 12px;
            border-left: 4px solid #17a2b8;
        }
        
        .examples h3 {
            color: #333;
            margin-bottom: 15px;
            font-size: 1.1rem;
        }
        
        .examples ul {
            list-style: none;
        }
        
        .examples li {
            margin-bottom: 8px;
            color: #666;
            font-size: 0.9rem;
        }
        
        .examples li::before {
            content: "→";
            color: #17a2b8;
            margin-right: 8px;
            font-weight: bold;
        }
        
        @media (max-width: 768px) {
            .container {
                padding: 30px 20px;
                margin: 10px;
            }
            
            .header h1 {
                font-size: 2rem;
            }
            
            .header p {
                font-size: 1rem;
            }
            
            .button-group {
                flex-direction: column;
            }
            
            .action-btn {
                min-width: auto;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🌐 网站代理服务</h1>
            <p>输入任意网址，获取代理链接，轻松访问被限制的网站</p>
        </div>
        
        <form id="proxyForm">
            <div class="form-group">
                <label for="url">请输入要代理的网址：</label>
                <div class="input-container">
                    <input 
                        type="url" 
                        id="url" 
                        name="url" 
                        placeholder="例如：https://www.google.com" 
                        required
                        autocomplete="url"
                    >
                </div>
            </div>
            
            <button type="submit" class="btn" id="generateBtn">
                生成代理链接
            </button>
        </form>
        
        <div class="loading" id="loading">
            <div class="spinner"></div>
            正在生成代理链接...
        </div>
        
        <div class="result" id="result">
            <h3>✅ 代理链接已生成</h3>
            <div class="result-url" id="proxyUrl"></div>
            <div class="button-group">
                <button class="action-btn copy-btn" id="copyBtn" onclick="copyToClipboard()">
                    📋 复制链接
                </button>
                <button class="action-btn visit-btn" id="visitBtn" onclick="visitProxyUrl()">
                    🚀 访问网站
                </button>
            </div>
        </div>
        
        <div class="error" id="error">
            <strong>错误：</strong><span id="errorMessage"></span>
        </div>
        
        <div class="examples">
            <h3>📝 使用示例</h3>
            <ul>
                <li>输入 google.com → 生成 google-com.${domain}</li>
                <li>输入 github.com → 生成 github-com.${domain}</li>
                <li>输入 api.github.com → 生成 api-github-com.${domain}</li>
            </ul>
        </div>
    </div>

    <script>
        const form = document.getElementById('proxyForm');
        const loading = document.getElementById('loading');
        const result = document.getElementById('result');
        const error = document.getElementById('error');
        const proxyUrl = document.getElementById('proxyUrl');
        const generateBtn = document.getElementById('generateBtn');
        const copyBtn = document.getElementById('copyBtn');
        const visitBtn = document.getElementById('visitBtn');
        
        let currentProxyUrl = '';
        
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const url = document.getElementById('url').value.trim();
            if (!url) return;
            
            // 确保URL有协议
            let fullUrl = url;
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                fullUrl = 'https://' + url;
            }
            
            // 显示加载状态
            showLoading();
            hideResult();
            hideError();
            
            try {
                const response = await fetch('/api/generate', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ url: fullUrl })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    currentProxyUrl = data.proxyUrl;
                    proxyUrl.textContent = currentProxyUrl;
                    showResult();
                } else {
                    showError(data.error || '生成代理链接失败');
                }
            } catch (err) {
                console.error('Error:', err);
                showError('网络错误，请稍后重试');
            } finally {
                hideLoading();
            }
        });
        
        function showLoading() {
            loading.classList.add('show');
            generateBtn.disabled = true;
        }
        
        function hideLoading() {
            loading.classList.remove('show');
            generateBtn.disabled = false;
        }
        
        function showResult() {
            result.classList.add('show');
            resetButtonStates();
        }
        
        function hideResult() {
            result.classList.remove('show');
        }
        
        function showError(message) {
            document.getElementById('errorMessage').textContent = message;
            error.classList.add('show');
        }
        
        function hideError() {
            error.classList.remove('show');
        }
        
        function resetButtonStates() {
            copyBtn.textContent = '📋 复制链接';
            copyBtn.classList.remove('copied');
            visitBtn.textContent = '🚀 访问网站';
        }
        
        async function copyToClipboard() {
            try {
                await navigator.clipboard.writeText(currentProxyUrl);
                copyBtn.textContent = '✅ 已复制';
                copyBtn.classList.add('copied');
                
                setTimeout(() => {
                    copyBtn.textContent = '📋 复制链接';
                    copyBtn.classList.remove('copied');
                }, 2000);
            } catch (err) {
                // 降级处理
                const textArea = document.createElement('textarea');
                textArea.value = currentProxyUrl;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                
                copyBtn.textContent = '✅ 已复制';
                copyBtn.classList.add('copied');
                
                setTimeout(() => {
                    copyBtn.textContent = '📋 复制链接';
                    copyBtn.classList.remove('copied');
                }, 2000);
            }
        }
        
        function visitProxyUrl() {
            if (!currentProxyUrl) {
                showError('没有可访问的代理链接');
                return;
            }
            
            // 提供用户反馈
            visitBtn.textContent = '🔄 跳转中...';
            visitBtn.disabled = true;
            
            // 延迟一下以显示反馈，然后跳转
            setTimeout(() => {
                try {
                    // 在新标签页中打开代理链接
                    window.open(currentProxyUrl, '_blank', 'noopener,noreferrer');
                } catch (err) {
                    console.error('跳转失败:', err);
                    showError('跳转失败，请手动复制链接访问');
                } finally {
                    // 重置按钮状态
                    setTimeout(() => {
                        visitBtn.textContent = '🚀 访问网站';
                        visitBtn.disabled = false;
                    }, 1000);
                }
            }, 300);
        }
        
        // 自动聚焦输入框
        document.getElementById('url').focus();
        
        // 键盘快捷键支持
        document.addEventListener('keydown', (e) => {
            // Ctrl/Cmd + Enter 快速生成
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                if (!generateBtn.disabled) {
                    form.dispatchEvent(new Event('submit'));
                }
            }
            
            // 结果显示时的快捷键
            if (result.classList.contains('show')) {
                // Ctrl/Cmd + C 复制
                if ((e.ctrlKey || e.metaKey) && e.key === 'c' && e.target.tagName !== 'INPUT') {
                    e.preventDefault();
                    copyToClipboard();
                }
                
                // Ctrl/Cmd + V 访问（这里用 V 代表 Visit）
                if ((e.ctrlKey || e.metaKey) && e.key === 'v' && e.target.tagName !== 'INPUT') {
                    e.preventDefault();
                    visitProxyUrl();
                }
            }
        });
    </script>
</body>
</html>`;
}


/**
 * 提取并验证子域名
 * @param {string} hostname - 主机名
 * @returns {string|null} - 子域名或null
 */
function extractSubdomain(hostname) {
  const parts = hostname.split('.');
  if (parts.length < 2) return null;
  
  const subdomain = parts[0];
  
  // 验证子域名格式（允许字母数字和连字符）
  if (!/^[a-zA-Z0-9-]+$/.test(subdomain)) {
    return null;
  }
  
  // 验证连字符格式的子域名
  if (!isValidSubdomainFormat(subdomain)) {
    return null;
  }
  
  return subdomain;
}

/**
 * 验证子域名格式是否符合要求
 * @param {string} subdomain - 子域名
 * @returns {boolean} - 是否有效
 */
function isValidSubdomainFormat(subdomain) {
  // 不能以连字符开头或结尾
  if (subdomain.startsWith('-') || subdomain.endsWith('-')) {
    return false;
  }
  
  
  // 分割后至少要有2个部分（修改为2个部分）
  const parts = subdomain.split('--');
  if (parts.length < 2) {
    return false;
  }
  
  // 每个部分都必须有效
  return parts.every(part => {
    return part.length > 0 && /^[a-zA-Z0-9-]+$/.test(part);
  });
}

/**
 * 构建目标URL
 * @param {string} subdomain - 子域名（格式：aaa-bb-com）
 * @param {URL} originalUrl - 原始URL对象
 * @returns {URL} - 目标URL对象
 */
function buildTargetUrl(subdomain, originalUrl) {
  // 将连字符格式转换为点分格式
  const targetDomain = convertSubdomainToUrl(subdomain);
  
  if (!targetDomain) {
    throw new Error('Invalid subdomain format');
  }
  
  const targetUrl = new URL(`https://${targetDomain}`);
  targetUrl.pathname = originalUrl.pathname;
  targetUrl.search = originalUrl.search;
  
  return targetUrl;
}

/**
 * 将连字符格式的子域名转换为标准URL格式
 * @param {string} subdomain - 连字符格式的子域名（如：aaa-bb-com）
 * @returns {string|null} - 转换后的域名（如：aaa.bb.com）或null（如果格式无效）
 */
function convertSubdomainToUrl(subdomain) {
  if (!subdomain || typeof subdomain !== 'string') {
    return null;
  }
  
  // 移除首尾空白字符
  subdomain = subdomain.trim();
  
  // 验证基本格式：只允许字母、数字和连字符
  if (!/^[a-zA-Z0-9-]+$/.test(subdomain)) {
    return null;
  }
  
  // 分割连字符
  const parts = subdomain.split('--');
  
  // 至少需要2个部分才能构成有效的域名（修改为2个部分）
  if (parts.length < 2) {
    return null;
  }
  
  // 验证每个部分都不为空
  if (parts.some(part => !part || part.length === 0)) {
    return null;
  }
  
  // 将连字符替换为点号
  return parts.join('.');
}

/**
 * 执行代理请求
 * @param {Request} originalRequest - 原始请求
 * @param {URL} targetUrl - 目标URL
 * @returns {Promise<Response>} - 代理响应
 */
async function proxyRequest(originalRequest, targetUrl) {
  // 准备请求选项
  const requestOptions = {
    method: originalRequest.method,
    headers: cleanRequestHeaders(originalRequest.headers, targetUrl),
    redirect: 'manual', // 手动处理重定向以避免循环
    // 添加超时控制
    signal: AbortSignal.timeout(CONFIG.REQUEST_TIMEOUT)
  };
  
  // 处理请求体（GET和HEAD请求不应该有body）
  if (!['GET', 'HEAD'].includes(originalRequest.method)) {
    requestOptions.body = originalRequest.body;
  }
  
  try {
    const response = await fetch(targetUrl.toString(), requestOptions);
    
    // 处理重定向
    if (response.status >= 300 && response.status < 400) {
      return handleRedirect(response, originalRequest);
    }
    
    return createProxyResponse(response);
    
  } catch (error) {
    if (error.name === 'TimeoutError') {
      return createErrorResponse('Request timeout', 504);
    }
    throw error;
  }
}

/**
 * 清理请求头
 * @param {Headers} originalHeaders - 原始请求头
 * @param {URL} targetUrl - 目标URL
 * @returns {Headers} - 清理后的请求头
 */
function cleanRequestHeaders(originalHeaders, targetUrl) {
  const cleanedHeaders = new Headers();
  
  // 复制允许的请求头
  for (const [key, value] of originalHeaders.entries()) {
    const lowerKey = key.toLowerCase();
    if (!CONFIG.BLOCKED_HEADERS.includes(lowerKey)) {
      cleanedHeaders.set(key, value);
    }
  }
  
  // 设置正确的目标服务器信息
  cleanedHeaders.set('Host', targetUrl.hostname);
  
  // 如果原始请求有 Origin，则更新为目标域名
  if (originalHeaders.has('Origin')) {
    cleanedHeaders.set('Origin', targetUrl.origin);
  }
  
  // 如果原始请求有 Referer，则更新为目标域名
  if (originalHeaders.has('Referer')) {
    const referer = originalHeaders.get('Referer');
    try {
      const refererUrl = new URL(referer);
      refererUrl.hostname = targetUrl.hostname;
      cleanedHeaders.set('Referer', refererUrl.toString());
    } catch (e) {
      // 如果 Referer 格式不正确，则删除它
      cleanedHeaders.delete('Referer');
    }
  }
  
  return cleanedHeaders;
}

/**
 * 创建代理响应
 * @param {Response} originalResponse - 原始响应
 * @returns {Response} - 处理后的响应
 */
function createProxyResponse(originalResponse) {
  // 创建新的响应对象
  const response = new Response(originalResponse.body, {
    status: originalResponse.status,
    statusText: originalResponse.statusText,
    headers: originalResponse.headers
  });
  
  // 添加CORS头
  addCorsHeaders(response.headers);
  
  // 移除可能导致问题的安全头
  response.headers.delete('Content-Security-Policy');
  response.headers.delete('X-Frame-Options');
  
  return response;
}

/**
 * 处理重定向
 * @param {Response} response - 重定向响应
 * @param {Request} originalRequest - 原始请求
 * @returns {Response} - 处理后的响应
 */
function handleRedirect(response, originalRequest) {
  const location = response.headers.get('Location');
  if (!location) {
    return createProxyResponse(response);
  }
  
  try {
    const redirectUrl = new URL(location);
    const originalUrl = new URL(originalRequest.url);
    
    // 如果重定向的URL是标准域名格式，需要转换回代理格式
    if (isStandardDomain(redirectUrl.hostname)) {
      const convertedSubdomain = convertUrlToSubdomain(redirectUrl.hostname);
      if (convertedSubdomain) {
        // 构建代理域名
        const originalHostParts = originalUrl.hostname.split('.');
        const proxyDomain = originalHostParts.slice(1).join('.');
        redirectUrl.hostname = `${convertedSubdomain}.${proxyDomain}`;
        
        const redirectResponse = new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
        
        redirectResponse.headers.set('Location', redirectUrl.toString());
        addCorsHeaders(redirectResponse.headers);
        
        return redirectResponse;
      }
    }
  } catch (e) {
    console.error('Redirect handling error:', e);
  }
  
  return createProxyResponse(response);
}

/**
 * 检查是否为标准域名格式
 * @param {string} hostname - 主机名
 * @returns {boolean} - 是否为标准域名
 */
function isStandardDomain(hostname) {
  // 检查是否为标准域名格式（包含点号的域名）
  return /^[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$/.test(hostname) && 
         hostname.includes('.') &&
         !hostname.includes('-');
}

/**
 * 将标准URL格式转换回连字符格式
 * @param {string} hostname - 标准域名（如：aaa.bb.com）
 * @returns {string|null} - 连字符格式（如：aaa-bb-com）或null
 */
function convertUrlToSubdomain(hostname) {
  if (!hostname || typeof hostname !== 'string') {
    return null;
  }
  
  // 验证域名格式
  if (!/^[a-zA-Z0-9.-]+$/.test(hostname)) {
    return null;
  }
  
  // 将点号替换为连字符
  return hostname.replace(/\./g, '--');
}

/**
 * 处理 OPTIONS 预检请求
 * @param {Request} request - 原始请求
 * @returns {Response} - OPTIONS响应
 */
function handleOptions(request) {
  const headers = new Headers();
  addCorsHeaders(headers);
  
  // 处理预检请求的特定头
  const requestHeaders = request.headers.get('Access-Control-Request-Headers');
  if (requestHeaders) {
    headers.set('Access-Control-Allow-Headers', requestHeaders);
  }
  
  const requestMethod = request.headers.get('Access-Control-Request-Method');
  if (requestMethod && CONFIG.ALLOWED_METHODS.includes(requestMethod)) {
    headers.set('Access-Control-Allow-Methods', CONFIG.ALLOWED_METHODS.join(', '));
  }
  
  return new Response(null, {
    status: 204,
    headers: headers
  });
}

/**
 * 添加CORS头
 * @param {Headers} headers - 响应头对象
 */
function addCorsHeaders(headers) {
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', CONFIG.ALLOWED_METHODS.join(', '));
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');
  headers.set('Access-Control-Max-Age', CONFIG.CORS_MAX_AGE);
  headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Type');
}

/**
 * 创建错误响应
 * @param {string} message - 错误消息
 * @param {number} status - HTTP状态码
 * @returns {Response} - 错误响应
 */
function createErrorResponse(message, status = 500) {
  const errorBody = JSON.stringify({
    error: message,
    status: status,
    timestamp: new Date().toISOString()
  });
  
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8'
  });
  
  addCorsHeaders(headers);
  
  return new Response(errorBody, {
    status: status,
    headers: headers
  });
}
