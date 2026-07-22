# OntologyOps 开发版本控制规则

> 状态：生效
>
> 来源：由项目负责人提供的 `agent-version-control-rules.md` 迁入本项目。本文是 OntologyOps 后续所有代码、配置、文档及部署变更的强制规则。

## 适用范围与前置条件

- 本规则仅约束 OntologyOps 项目；不应把项目外的临时文件、个人资料或其他项目纳入提交。
- 当前仓库尚未建立首次提交和远端。开始开发前，必须由项目负责人确认远端地址，并建立 `main` 与 `dev` 两个分支的初始基线；基线完成后，以下规则无例外执行。
- 文档评审阶段不触发部署；进入实现后，任何改动均执行本规则。

## 规则 1：每次改动必须 commit + push

- 无论改动大小（包括一个按钮颜色），改完后立即提交并推送至 `dev`：

  ```bash
  git add -A
  git commit -m "中文描述改了什么"
  git push origin dev
  ```

- 不允许跳过 commit 直接看效果或部署。
- commit message 必须使用中文，清楚描述改动内容。

## 规则 2：测试环境（staging）部署流程

- `dev` 分支直接部署至 staging，无需合并。
- 部署后必须由项目负责人确认 UI 与功能。
- 获得“确认 OK”前，不得进入下一步。
- 确认后立即建立并推送标签：

  ```bash
  git tag staging-YYYYMMDD-HHMM
  git push origin --tags
  ```

## 规则 3：正式环境（production）部署流程

- 仅可从 `main` 部署生产；不得从 `dev` 或本地未推送状态直接部署。
- 流程如下：

  ```bash
  git checkout main
  git merge dev
  git tag prod-YYYYMMDD-HHMM
  git push origin --tags
  ```

- 再从 `main` 部署至生产服务器。
- 部署后须由项目负责人确认线上正常才算完成。

## 规则 4：故障回滚

- 生产环境出现问题：检出上一个 `prod-*` 标签后重新部署。
- 测试环境出现问题：检出上一个 `staging-*` 标签后重新部署。
- 禁止在故障环境中临时改代码“试试看”；先恢复到最近已确认的存档点，再分析与修复。

## 规则 5：仅保留两个长期分支

- `main`：正式环境，只能通过从 `dev` 合并进入，不直接修改。
- `dev`：测试环境，日常开发在此进行。
- 不创建额外长期分支，除非项目负责人明确要求。

## 一句话执行准则

**改代码必 commit → `dev` 上 staging 测试 → 项目负责人确认后打 staging tag → 合并到 `main` → 部署生产 → 项目负责人确认后打 prod tag。每一步都有可回退存档。**
