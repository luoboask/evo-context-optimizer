// ============================================================
// Context Optimizer Plugin for OpenClaw
// Analyzes token usage, optimizes context, manages snapshots & rollback
// ============================================================
import { Type } from '@sinclair/typebox';
import * as fs from 'fs';
import * as path from 'path';
import { analyzeContext } from './analyzer.js';
import {
  applyOptimizations,
  ensureGitRepo,
  createSnapshotCommit,
  getGitHistory,
  generateToolDenyList,
  generateConfigPatches
} from './optimizer.js';
import {
  saveSnapshot,
  listSnapshots,
  getLatestSnapshot,
  restoreFromSnapshot,
  getSnapshot
} from './snapshots.js';
import type { OptimizerConfig, AnalysisResult, OptimizationSuggestion } from './types.js';

function resolveWorkspaceDir(api: any): string {
  // Try to get workspace dir from API context
  try {
    const cfg = api.getConfig?.() || {};
    return cfg.workspaceDir || cfg.agents?.defaults?.workspaceDir || process.cwd();
  } catch {
    return process.cwd();
  }
}

function buildConfig(workspaceDir: string): OptimizerConfig {
  return {
    workspaceDir,
    snapshotsDir: path.join(workspaceDir, '.context-optimizer'),
    maxSnapshots: 10,
    autoGitInit: true,
    contextWindow: 300000
  };
}

function formatSize(chars: number): string {
  if (chars > 100000) return `${(chars / 1000).toFixed(0)}k`;
  if (chars > 1000) return `${(chars / 1000).toFixed(1)}k`;
  return `${chars}`;
}

const plugin = {
  id: 'evo-context-optimizer',
  name: 'Evo Context Optimizer',
  description: 'Token analysis, context optimization, snapshot management, and rollback support (Evo-Cortex ecosystem)',
  configSchema: {
    type: 'object',
    additionalProperties: true,
    properties: {
      workspaceDir: {
        type: 'string',
        description: 'Workspace directory path'
      },
      snapshotsDir: {
        type: 'string',
        description: 'Snapshot storage directory'
      },
      maxSnapshots: {
        type: 'number',
        description: 'Maximum snapshots to keep',
        default: 10
      },
      contextWindow: {
        type: 'number',
        description: 'Model context window size in tokens',
        default: 300000
      },
      verbose: {
        type: 'boolean',
        description: 'Enable verbose logging',
        default: false
      }
    }
  },

  register(api: any) {
    const log = (msg: string) => {
      console.log(`[context-optimizer] ${msg}`);
    };

    const config = api.getConfig?.() || {};
    const pluginConfig = config.plugins?.entries?.['context-optimizer']?.config || {};
    const workspaceDir = resolveWorkspaceDir(api);

    log(`Plugin registered. Workspace: ${workspaceDir}`);

    // ========== 1. Token Analysis Tool ==========
    api.registerTool(() => ({
      name: 'context_token_analysis',
      description: '分析上下文 token 使用情况，显示各部分占用大小和优化建议',
      parameters: Type.Object({
        detail: Type.Optional(Type.Boolean({ description: 'Show detailed breakdown (default: true)' }))
      }),
      async execute(_id: string, params: any) {
        try {
          const cfg = buildConfig(workspaceDir);
          const result = analyzeContext(cfg);

          let text = '🧠 Context Token Analysis\n';
          text += '═'.repeat(40) + '\n';
          text += `Total: ${formatSize(result.totalChars)} chars (~${result.totalTokens.toLocaleString()} tokens)\n`;
          text += `Context Window: ${formatSize(result.contextWindow)}\n`;
          text += `Usage: ${result.usagePercent.toFixed(1)}%\n`;
          text += '─'.repeat(40) + '\n';
          text += 'Breakdown:\n';

          const sorted = [...result.breakdown].sort((a, b) => b.chars - a.chars);
          for (const item of sorted) {
            const icon = item.status === 'critical' ? '🔴' : item.status === 'warning' ? '🟡' : '🟢';
            text += `  ${icon} ${item.section.padEnd(25)} ${formatSize(item.chars).padStart(10)} chars (${item.estimatedTokens.toLocaleString()} tok) ${item.percentage.toFixed(1)}%\n`;
            if (item.suggestion) {
              text += `     💡 ${item.suggestion}\n`;
            }
          }

          text += '\n💡 Optimization Suggestions:\n';
          text += '─'.repeat(40) + '\n';
          for (const opt of result.optimizations) {
            const impact = opt.impact === 'high' ? '🔴' : opt.impact === 'medium' ? '🟡' : '🟢';
            text += `  ${impact} ${opt.title}\n`;
            text += `     ${opt.description}\n`;
            text += `     Est. savings: ~${formatSize(opt.estimatedSavings)} chars\n\n`;
          }

          return {
            content: [{ type: 'text', text }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Error analyzing context: ${error.message}` }]
          };
        }
      }
    }));

    // ========== 2. Context Optimize Tool ==========
    api.registerTool(() => ({
      name: 'context_optimize',
      description: '主动优化上下文，保存快照并记录变更。支持 git 版本控制',
      parameters: Type.Object({
        action: Type.String({
          description: 'Action: analyze, run, dry-run',
          enum: ['analyze', 'run', 'dry-run']
        }),
        label: Type.Optional(Type.String({ description: 'Snapshot label (default: auto-optimization)' }))
      }),
      async execute(_id: string, params: any) {
        try {
          const cfg = buildConfig(workspaceDir);
          const result = analyzeContext(cfg);
          const action = params.action || 'analyze';
          const label = params.label || 'auto-optimization';

          if (action === 'analyze') {
            // Just show analysis
            let text = '🔍 Optimization Analysis\n\n';
            text += `Current usage: ${formatSize(result.totalChars)} chars (~${result.totalTokens.toLocaleString()} tokens)\n\n`;

            if (result.optimizations.length === 0) {
              text += '✅ No optimizations needed.';
            } else {
              text += `Found ${result.optimizations.length} optimization opportunities:\n\n`;
              for (const opt of result.optimizations) {
                text += `• ${opt.title}\n  ${opt.description}\n  Savings: ~${formatSize(opt.estimatedSavings)} chars\n\n`;
              }
            }

            return { content: [{ type: 'text', text }] };
          }

          if (action === 'dry-run') {
            let text = '🔧 Dry Run - Optimization Preview\n\n';
            for (const opt of result.optimizations) {
              text += `• ${opt.title}\n  ${opt.description}\n  Savings: ~${formatSize(opt.estimatedSavings)} chars\n\n`;
            }
            text += '\nRun with action="run" to apply.';
            return { content: [{ type: 'text', text }] };
          }

          // action === 'run': Apply optimizations
          ensureGitRepo(cfg.workspaceDir);
          const changes = applyOptimizations(result.optimizations, cfg);

          let text = '🔧 Context Optimization Applied\n\n';

          if (changes.length > 0) {
            const gitCommit = createSnapshotCommit(cfg.workspaceDir, label, changes);

            const snapshot = saveSnapshot(cfg, label, result, undefined, changes, gitCommit || undefined);

            text += `Applied ${changes.length} optimizations:\n\n`;
            for (const change of changes) {
              const saved = change.beforeChars - change.afterChars;
              text += `• ${change.file}: ${formatSize(change.beforeChars)} → ${formatSize(change.afterChars)} (saved ${formatSize(saved)} chars)\n`;
            }
            if (gitCommit) text += `\nGit commit: ${gitCommit}`;
            text += `\nSnapshot: ${snapshot.id}`;
          } else {
            text += 'No optimizations needed — all files within acceptable limits.';
          }

          // Add config suggestions
          const configPatches = generateConfigPatches(result.optimizations);
          if (Object.keys(configPatches).length > 0) {
            text += '\n\n📋 Suggested config:\n```json\n' + JSON.stringify(configPatches, null, 2) + '\n```';
          }

          return { content: [{ type: 'text', text }] };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Error optimizing context: ${error.message}` }]
          };
        }
      }
    }));

    // ========== 3. Snapshot List Tool ==========
    api.registerTool(() => ({
      name: 'context_snapshot_list',
      description: '列出所有优化快照',
      parameters: Type.Object({}),
      async execute(_id: string) {
        try {
          const cfg = buildConfig(workspaceDir);
          const snapshots = listSnapshots(cfg);

          if (snapshots.length === 0) {
            return { content: [{ type: 'text', text: 'No snapshots found.' }] };
          }

          let text = '📸 Optimization Snapshots\n';
          text += '═'.repeat(40) + '\n';

          for (const snap of snapshots) {
            text += `\nID: ${snap.id}\n`;
            text += `Label: ${snap.label}\n`;
            text += `Time: ${new Date(snap.timestamp).toLocaleString()}\n`;
            text += `Changes: ${snap.changes.length}\n`;
            for (const change of snap.changes) {
              const saved = change.beforeChars - change.afterChars;
              text += `  • ${change.action} ${change.file}: ${formatSize(change.beforeChars)} → ${formatSize(change.afterChars)} (saved ${formatSize(saved)})\n`;
            }
            if (snap.gitCommit) text += `Git: ${snap.gitCommit}\n`;
            text += '─'.repeat(30) + '\n';
          }

          return { content: [{ type: 'text', text }] };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Error listing snapshots: ${error.message}` }]
          };
        }
      }
    }));

    // ========== 4. Rollback Tool ==========
    api.registerTool(() => ({
      name: 'context_rollback',
      description: '回滚到指定快照或最新版本。如果优化后内容有问题，可恢复到之前状态',
      parameters: Type.Object({
        snapshot_id: Type.Optional(Type.String({ description: 'Snapshot ID to rollback to (default: latest)' }))
      }),
      async execute(_id: string, params: any) {
        try {
          const cfg = buildConfig(workspaceDir);
          let snapshotId = params.snapshot_id;

          if (!snapshotId) {
            const latest = getLatestSnapshot(cfg);
            if (!latest) {
              return { content: [{ type: 'text', text: 'No snapshots available for rollback.' }] };
            }
            snapshotId = latest.id;
          }

          const snapshot = getSnapshot(cfg, snapshotId);
          if (!snapshot) {
            return { content: [{ type: 'text', text: `Snapshot not found: ${snapshotId}` }] };
          }

          const restored = restoreFromSnapshot(cfg, snapshotId);

          let text = `🔄 Rollback to: ${snapshot.label}\n`;
          text += `Snapshot: ${snapshot.timestamp}\n`;

          if (restored) {
            text += '\n✅ Rollback successful\n';
            text += 'Files restored:\n';
            for (const change of snapshot.changes) {
              text += `• ${change.file}: restored to ${formatSize(change.beforeChars)} chars\n`;
            }
          } else {
            text += '\n❌ Rollback failed';
          }

          return { content: [{ type: 'text', text }] };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Error during rollback: ${error.message}` }]
          };
        }
      }
    }));

    log('All tools registered: context_token_analysis, context_optimize, context_snapshot_list, context_rollback');
  }
};

export default plugin;
