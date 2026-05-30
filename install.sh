#!/usr/bin/env bash
# opencode-agents 一键安装脚本
# 用法: curl -fsSL https://gitee.com/aerlee/opencode-agents/raw/master/install.sh | bash

set -euo pipefail

REPO_URL="https://gitee.com/aerlee/opencode-agents.git"
TARGET_DIR="${HOME}/.config/opencode/agents"
BACKUP_DIR="${HOME}/.config/opencode/agents-备份-$(date +%Y%m%d%H%M%S)"
TEMP_DIR=$(mktemp -d)

echo "🚀 opencode-agents 安装脚本"
echo "================================"

# 检查 git
if ! command -v git &>/dev/null; then
    echo "❌ 需要安装 git"
    exit 1
fi

# 备份已有 agents
if [ -d "$TARGET_DIR" ]; then
    echo "📦 备份已有 agents 到: $BACKUP_DIR"
    cp -r "$TARGET_DIR" "$BACKUP_DIR"
fi

# 克隆仓库到临时目录
echo "📥 正在下载 agents..."
git clone --depth 1 "$REPO_URL" "$TEMP_DIR" 2>/dev/null

# 创建目标目录
mkdir -p "$TARGET_DIR"

# 复制 agents 文件
echo "📂 安装 agents 到: $TARGET_DIR"
cp "$TEMP_DIR"/agents/*.md "$TARGET_DIR/"

# 清理
rm -rf "$TEMP_DIR"

# 统计
AGENT_COUNT=$(ls -1 "$TARGET_DIR"/*.md 2>/dev/null | wc -l)
echo ""
echo "✅ 安装完成！共 ${AGENT_COUNT} 个智能体"
echo ""
echo "已安装的智能体:"
echo "  主智能体:"
ls -1 "$TARGET_DIR"/{Zero,Erribaba}.md 2>/dev/null | while read f; do
    echo "    - $(basename "$f" .md)"
done
echo "  子智能体:"
ls -1 "$TARGET_DIR"/*.md 2>/dev/null | grep -v -E '(Zero|Erribaba)\.md' | while read f; do
    echo "    - $(basename "$f" .md)"
done

echo ""
echo "📋 下一步："
echo "  1. 编辑 ~/.config/opencode/opencode.json 配置模型和 provider"
echo "  2. 在 opencode.json 中设置 \"default_agent\" 选择主智能体"
echo "  3. 启动 opencode 开始使用"
echo ""
echo "💡 提示：将下方提示词复制到你的 OpenCode 智能体中，"
echo "   它会帮你自动配置模型并更新智能体文件。"
echo ""
echo "================================"
cat << 'PROMPT'
--- 复制以下提示词发送给你的 OpenCode 智能体 ---

我刚刚安装了 opencode-agents 智能体集合（位于 ~/.config/opencode/agents/）。
请你帮我完成以下配置：

## 第一步：确认已有 provider 和模型

请读取 ~/.config/opencode/opencode.json，列出我当前已配置的 provider 和模型。

## 第二步：选择模型

以下是智能体集合中每个智能体默认使用的模型，请根据我已有的 provider 和模型，
为每个智能体选择一个可用的模型（优先选择能力更强的模型）：

| 智能体 | 默认模型 | 角色 |
|--------|----------|------|
| Zero | opencode-go/mimo-v2.5 | 主智能体（快速原型，多模态） |
| Erribaba | Xianyu/mimo-v2.5-pro | 主智能体（生产代码，深度分析） |
| api-designer | opencode-go/mimo-v2.5-pro | API 设计 |
| architect | opencode-go/glm-5.1 | 架构设计 |
| code-generator | opencode-go/mimo-v2.5-pro | 代码生成 |
| db-engineer | opencode-go/deepseek-v4-pro | 数据库工程 |
| debugger | opencode-go/deepseek-v4-pro | 调试诊断 |
| devops | opencode-go/mimo-v2.5-pro | DevOps/CI-CD |
| doc-writer | opencode-go/qwen3.6-plus | 文档编写 |
| e2e-tester | opencode-go/mimo-v2.5-pro | 端到端测试 |
| executor | opencode-go/minimax-m2.7 | 命令执行 |
| frontend-dev | opencode-go/kimi-k2.6 | 前端开发 |
| frontend-reviewer | opencode-go/mimo-v2.5 | 前端审查 |
| git-assistant | opencode-go/mimo-v2.5 | Git 工作流 |
| migration | opencode-go/deepseek-v4-pro | 迁移专家 |
| perf-optimizer | opencode-go/mimo-v2.5-pro | 性能优化 |
| project-manager | opencode-go/qwen3.6-plus | 项目管理 |
| refactorer | opencode-go/mimo-v2.5-pro | 代码重构 |
| research | opencode-go/qwen3.6-plus | 信息研究 |
| reviewer | opencode-go/deepseek-v4-pro | 代码审查 |
| security-auditor | opencode-go/deepseek-v4-pro | 安全审计 |
| software-engineer | opencode-go/mimo-v2.5 | 全栈实现 |
| test-writer | opencode-go/mimo-v2.5-pro | 测试编写 |
| ui-designer | opencode-go/kimi-k2.6 | UI 设计 |
| validator | opencode-go/minimax-m2.7 | 结果验证 |
| vision-dev | opencode-go/mimo-v2.5 | 视觉开发 |

如果我没有某个 provider，告诉我哪些模型需要额外配置。
如果我已有对应的模型，直接进入第三步。

## 第三步：更新智能体文件

读取 ~/.config/opencode/agents/ 下所有 .md 文件，将每个文件 frontmatter 中的 `model:`
字段替换为你在第二步中为该智能体选择的模型。

## 第四步：设置主智能体

将 ~/.config/opencode/opencode.json 中的 `default_agent` 设置为 "Erribaba"。
（如果用户更喜欢快速原型模式，改为 "Zero"）

## 第五步：验证

列出所有智能体及其使用的模型，确认配置完成。
PROMPT
echo ""
