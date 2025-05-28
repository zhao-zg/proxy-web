## 🚀 完整部署教程（学习用途）

### 方法一：一键部署学习环境

点击下方按钮部署学习环境：

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/your-username/cloudflare-proxy-worker)

### 方法二：手动部署学习（推荐）

#### 步骤1：创建 Worker

1. **登录 Cloudflare Dashboard**
   - 访问 [Cloudflare Dashboard](https://dash.cloudflare.com/)
   - 选择你的账户

2. **创建新 Worker**
   - 进入 `Workers & Pages` 页面
   - 点击 `Create application`
   - 选择 `Create Worker`
   - 输入 Worker 名称（如：`proxy-learning-worker`）

3. **部署代码**
   - 复制 [`worker.js`](./worker.js) 中的完整代码
   - 粘贴到 Worker 编辑器中
   - 点击 `Save and Deploy`

#### 步骤2：配置 Workers 路由（关键步骤）

**重要：必须配置 Workers 路由才能使自定义域名生效**

1. **进入域名的 Workers 路由配置**
   - 在 Cloudflare Dashboard 中选择您的域名（如：`yourdomain.com`）
   - 点击左侧菜单的 `Workers Routes`

2. **添加路由规则**
   
   点击 `Add route` 按钮，配置以下路由：

   ```
   Route: *yourdomain.com/*
   Worker: proxy-learning-worker
   Zone: yourdomain.com
   ```

   **详细配置说明：**
   - **Route 字段**：`*yourdomain.com/*`
     - `*` 表示匹配所有子域名
     - 包括 `proxy.yourdomain.com`、`google--com.yourdomain.com` 等
   - **Worker 字段**：选择刚创建的 `proxy-learning-worker`
   - **Zone 字段**：选择对应的域名区域

3. **验证路由配置**
   
   配置完成后，路由列表应该显示：
   ```
   Route Pattern: *yourdomain.com/*
   Worker: proxy-learning-worker
   Status: Active
   ```

#### 步骤3：准备优选域名

在配置 DNS 之前，您需要准备一个优选域名。有几种方式：

**方法A：使用现有的优选域名**
```
常用优选域名示例（仅供学习参考）：
- cdn.cloudflare.com
- workers.cloudflare.com
- api.cloudflare.com
```

**方法B：自建优选域名**

1. **准备另一个域名**（如：`cf-proxy.com`）
2. **将该域名接入 Cloudflare**
3. **配置 A 记录指向优选 IP**：
   ```
   类型    名称    目标IP              代理状态
   A      @      104.16.132.229      开启代理（🟠）
   A      *      104.16.132.229      开启代理（🟠）
   ```

#### 步骤4：DNS 配置（使用优选域名）

**在您的主域名 DNS 服务商处配置：**

假设您的主域名是 `yourdomain.com`，优选域名是 `cf-proxy.com`

1. **配置泛域名 CNAME 记录**

   在 DNS 服务商（Cloudflare）配置：

   ```
   记录类型    主机记录    记录值                    代理状态
   CNAME      *          cf-proxy.com              关闭代理（☁️灰云）
   CNAME      @          cf-proxy.com              关闭代理（☁️灰云）
   ```

   **⚠️ 重要配置说明：**
   - **必须关闭 Cloudflare 代理**（使用灰云 ☁️，不要用橙云 🟠）
   - `*` 记录匹配所有子域名（`proxy.yourdomain.com`、`google--com.yourdomain.com` 等）
   - `@` 记录匹配根域名（`yourdomain.com`）

#### 步骤5：验证配置

1. **验证 DNS 解析**
   ```bash
   # 验证根域名
   nslookup yourdomain.com
   # 应该返回 cf-proxy.com 的 IP

   # 验证子域名
   nslookup proxy.yourdomain.com
   # 应该返回 cf-proxy.com 的 IP

   # 验证泛域名
   nslookup test.yourdomain.com
   # 应该返回 cf-proxy.com 的 IP
   ```

2. **验证 Workers 路由**
   ```bash
   # 测试管理面板
   curl -I https://proxy.yourdomain.com
   # 应该返回 200 状态码

   # 测试代理功能
   curl -I https://google--com.yourdomain.com
   # 应该能正常响应
   ```

3. **完整功能测试**
   - 访问 `https://proxy.yourdomain.com` 查看管理界面
   - 输入 `google.com` 生成代理链接
   - 点击访问按钮测试代理功能

#### 步骤6：高级优化配置

1. **多优选域名负载均衡**
   
   如果您有多个优选域名，可以配置多个 CNAME 记录：
   ```bash
   # 使用 DNS 负载均衡脚本
   # 每隔一段时间自动切换优选域名
   
   优选域名列表：
   - cf-proxy1.com
   - cf-proxy2.com  
   - cf-proxy3.com
   ```

2. **区域化优选配置**
   ```
   不同地区使用不同的优选域名：
   - 电信用户：cf-ct.com
   - 联通用户：cf-cu.com
   - 移动用户：cf-cm.com
   ```

## 🔧 完整配置架构图

```
用户请求流程：
用户访问 proxy.yourdomain.com
         ↓
DNS 解析：yourdomain.com → CNAME → cf-proxy.com → 优选IP
         ↓
请求到达 Cloudflare 边缘节点
         ↓
Workers 路由匹配：*yourdomain.com/* → proxy-learning-worker
         ↓
Worker 执行代理逻辑
         ↓
返回响应给用户
```

## 📋 配置检查清单

### Workers 配置
- [ ] Worker 成功创建并部署代码
- [ ] Workers 路由配置：`*yourdomain.com/*`
- [ ] 路由状态显示为 Active
- [ ] Worker 绑定到正确的域名区域

### DNS 配置
- [ ] 泛域名 CNAME：`* → cf-proxy.com`
- [ ] 根域名 CNAME：`@ → cf-proxy.com`
- [ ] 代理状态设置为灰云（☁️）
- [ ] DNS 解析生效（通常需要 5-10 分钟）

### 优选域名配置
- [ ] 优选域名正常解析
- [ ] 优选域名指向高速 IP
- [ ] 优选域名支持 HTTPS
- [ ] 优选域名访问速度理想

### 功能验证
- [ ] 管理面板正常访问
- [ ] 代理链接生成功能正常
- [ ] 代理访问功能正常
- [ ] 各种子域名都能正常工作

## 🛠️ 故障排除

### 常见问题及解决方案

1. **Workers 路由不生效**
   ```
   问题：访问域名显示 404 或默认页面
   解决：检查 Workers 路由配置是否正确
   验证：curl -H "Host: yourdomain.com" https://your-worker.workers.dev
   ```

2. **DNS 解析问题**
   ```
   问题：域名解析不到优选域名
   解决：检查 CNAME 记录配置，确保关闭代理
   验证：nslookup yourdomain.com
   ```

3. **优选域名访问慢**
   ```
   问题：虽然配置了优选域名但访问仍然很慢
   解决：重新测试优选 IP，更新优选域名配置
   工具：使用 CloudflareSpeedTest 测试
   ```

4. **HTTPS 证书问题**
   ```
   问题：HTTPS 访问提示证书错误
   解决：确保优选域名支持 SSL，或使用 Cloudflare 的通用证书
   ```

## ⚠️ 重要注意事项

1. **合规使用**
   - 本项目仅供技术学习和研究使用
   - 严格遵守相关法律法规
   - 不得用于访问违法违规内容

2. **性能监控**
   - 定期检查优选域名的访问速度
   - 监控 Worker 的使用量和性能
   - 及时更新配置以保持最佳性能

3. **安全防护**
   - 不要在生产环境中使用
   - 注意保护个人隐私和数据安全
   - 定期检查和更新代码

4. **维护建议**
   - 建议每月测试一次优选域名性能
   - 关注 Cloudflare 的政策更新
   - 备份重要的配置信息

通过以上完整的配置，您的学习环境就可以高效稳定地运行了！记住这只是用于技术学习和研究目的。
