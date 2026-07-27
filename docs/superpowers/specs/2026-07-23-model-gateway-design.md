# M5.0 模型网关设计

## 目标

为本体候选生成与后续受控智能助手提供一个本地、单租户的模型网关。首个真实 Provider 为 DeepSeek，模型选项固定为 `DeepSeek V4 Flash`（`deepseek-v4-flash`）和 `DeepSeek V4 Pro`（`deepseek-v4-pro`）。GPT 与“其他 OpenAI 兼容 API”保留为可配置 Provider；Mock 仅用于测试且在每条结果中明确标识。

## 约束

- 密钥仅由本机 `.env` / 操作系统环境变量读取；数据库、HTTP 响应、浏览器、审计与日志均不得出现密钥值。
- 每个 Profile 保存 Provider、显示名称、API 模型 ID、Base URL、`secret_ref`、用途、启用状态与验证状态；不保存 Key。
- 只有 `enabled=true` 且 `verification_status=verified` 的真实 Profile 可被选为默认模型。
- 缺 Key、网络失败、401/429/5xx、响应格式异常必须返回显式错误；不得自动改用 Mock 或虚构成功。
- 连接验证只调用兼容 API 的 `GET /models`，不发送企业数据或提示词；验证结果写入去敏审计。
- Agent 后续调用只接受发布的受控工具摘要和已裁剪证据，永不发送 SQL、路径、原始密钥或未授权字段。

## 资源与状态

`ModelProfile`：`provider_kind`（`deepseek|gpt|compatible|mock`）、`display_name`、`model_id`、`base_url`、`secret_ref`、`enabled`、`is_default`、`verification_status`（`unconfigured|pending|verified|failed`）、`last_verified_at`、`allowed_purposes`。

状态流转：`unconfigured → pending → verified → enabled/default`；验证失败进入 `failed`，已验证配置变更后回到 `pending`。Mock 独立配置、结果标记 `mode=mock`，不与真实 Profile 混淆。

## 页面与验收

管理员在“模型管理”选择 DeepSeek、Flash 或 Pro，系统只显示模型 ID、Base URL、环境变量名与连接状态；API Key 输入框不进入浏览器。保存配置后用户在本机 `.env` 填入 `DEEPSEEK_API_KEY`，点击测试连接；验证通过后才可设为默认。页面显示“已连接”只代表成功验证过当前配置。

本期不做模型训练、模型市场、成本结算、自动路由、任意 SQL、生产密钥托管或外部写回。
