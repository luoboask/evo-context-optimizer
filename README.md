# Context Optimizer Plugin

OpenClaw 插件：上下文 Token 分析、主动优化、快照管理和版本回滚。

## 功能

- **Token 分析** (`context_token_analysis`) — 查看各部分 token 占用及优化建议
- **主动优化** (`context_optimize`) — 自动优化 workspace 文件，减少上下文膨胀
- **快照管理** (`context_snapshot_list`) — 列出所有优化快照
- **回滚支持** (`context_rollback`) — 如果优化后内容有问题，恢复到之前版本

## 安装

```bash
openclaw plugins install -l /path/to/openclaw-context-optimizer
```

或在 `openclaw.json` 中配置：

```json
{
  "plugins": {
    "entries": {
      "context-optimizer": {
        "enabled": true,
        "config": {
          "maxSnapshots": 10,
          "contextWindow": 300000,
          "verbose": false
        }
      }
    }
  }
}
```

## 使用

### Token 分析

```
使用 context_token_analysis 工具
```

显示：
- 各部分 token 占用（系统提示、工具 schemas、workspace 文件、会话历史等）
- 优化建议（移除未用工具、精简大文件、启用 context pruning 等）

### 执行优化

```
使用 context_optimize 工具，action="dry-run" 预览
使用 context_optimize 工具，action="run" 执行
```

优化操作：
- 自动摘要大文件（保留标题和首段）
- Git 版本控制
- 保存快照（优化前后对比）

### 回滚

```
使用 context_snapshot_list 工具 查看快照
使用 context_rollback 工具 恢复到指定快照
```

## 工具列表

| 工具 | 说明 |
|---|---|
| `context_token_analysis` | 分析上下文 token 使用 |
| `context_optimize` | 执行优化（analyze/dry-run/run） |
| `context_snapshot_list` | 列出优化快照 |
| `context_rollback` | 回滚到指定快照 |

## 优化策略

1. **Workspace 文件精简** — 大文件自动摘要（保留结构）
2. **工具 Schema 建议** — 推荐移除未用工具
3. **Context Pruning** — 启用旧 tool results 裁剪
4. **Memory Flush 调优** — 降低 reserveTokensFloor 提前触发

## 快照结构

```
.context-optimizer/
├── snapshot-2026-04-27T00-00-00-000Z.json
├── snapshot-2026-04-27T01-00-00-000Z.json
└── ...
```

每个快照包含：
- 优化前分析结果
- 优化后分析结果
- 文件变更列表
- Git commit hash（如果启用了 git）

## 开发

```bash
npm install
npx tsc          # 构建
npx tsc --watch  # 开发模式
```

## License

MIT
