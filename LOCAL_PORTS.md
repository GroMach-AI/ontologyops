# OntologyOps 本地服务端口

> 本地开发核对用，不代表 staging/production。

## 端口速查

| 服务 | 地址 | 用途 |
|---|---|---|
| 正式前端 | http://127.0.0.1:5175 | React/Vite 开发服务器（dev 分支代码） |
| 正式 API | http://127.0.0.1:8001 | FastAPI 后端，`/api/models` 等接口 |
| 静态原型 | http://127.0.0.1:4176 | 静态 HTML 原型，信息架构与视觉评审基线 |

## 常用入口

- 前端首页：http://127.0.0.1:5175/
- 模型管理：http://127.0.0.1:5175/models
- 本体管理（正式前端）：http://127.0.0.1:5175/ontology
- 本体管理原型：http://127.0.0.1:4176/ontology-management-overview.html
- 对象映射原型：http://127.0.0.1:4176/ontology-object-mapping.html
- API 模型列表：http://127.0.0.1:8001/api/models

## 启动命令

```bash
# 前端 5175（dev 工作树）
cd .worktrees/dev/frontend
npm run dev -- --port 5175 --host 127.0.0.1

# 后端 8001 / 静态原型 4176：见 scripts/ 启动脚本
```

## 备注

- 前端代码在 `.worktrees/dev/frontend`（dev 分支），原型在根目录 `prototypes/`（main 分支最新）
- 改动提交到 dev 分支；push 前需 owner 确认
- 不读取 .env，不输出密钥
