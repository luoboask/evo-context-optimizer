// ============================================================
// Optimizer - applies optimizations and tracks changes
// ============================================================
import * as fs from 'fs';
import * as path from 'path';
import * as child from 'child_process';
import { OptimizationSuggestion, SnapshotChange, OptimizerConfig } from './types.js';

// Summarize a large workspace file by keeping headers and first paragraph
function summarizeFile(filePath: string, maxLength: number = 5000): string {
  const content = fs.readFileSync(filePath, 'utf-8');
  if (content.length <= maxLength) return content;

  const lines = content.split('\n');
  const result: string[] = [];
  let charCount = 0;
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.startsWith('```')) inCodeBlock = !inCodeBlock;

    // Always keep headers
    if (line.startsWith('#') || line.startsWith('##')) {
      result.push(line);
      charCount += line.length;
      continue;
    }

    // Skip code blocks in summary
    if (inCodeBlock) continue;

    // Keep first paragraph of each section
    if (line.trim() === '' && charCount > 0) {
      result.push(line);
      charCount += line.length;
      continue;
    }

    if (charCount < maxLength) {
      result.push(line);
      charCount += line.length;
    }
  }

  if (charCount < content.length) {
    result.push(`\n<!-- [SUMMARIZED] Original: ${content.length} chars → ${charCount} chars -->`);
  }

  return result.join('\n');
}

// Optimize a workspace file
function optimizeWorkspaceFile(
  filePath: string,
  suggestion: OptimizationSuggestion
): SnapshotChange {
  const before = fs.readFileSync(filePath, 'utf-8');
  let after: string;

  switch (suggestion.action) {
    case 'optimize':
      after = summarizeFile(filePath);
      break;
    case 'compress':
      after = summarizeFile(filePath, 3000);
      break;
    default:
      after = before;
  }

  fs.writeFileSync(filePath, after, 'utf-8');

  return {
    file: path.basename(filePath),
    action: 'modify',
    before,
    after,
    beforeChars: before.length,
    afterChars: after.length
  };
}

// Generate config suggestions
export function generateConfigPatches(suggestions: OptimizationSuggestion[]): Record<string, any> {
  const patches: Record<string, any> = {};

  for (const s of suggestions) {
    if (s.id === 'ctx-pruning') {
      patches.contextPruning = { mode: 'cache-ttl', ttl: '5m' };
    }
    if (s.id === 'memory-flush') {
      patches.compaction = { memoryFlush: { enabled: true }, reserveTokensFloor: 500000 };
    }
  }

  return patches;
}

// Create a tool deny list based on usage analysis
export function generateToolDenyList(unusedTools: string[]): string[] {
  const knownUnused = [
    'music_generate', 'video_generate', 'image_generate',
    'tts', 'canvas', 'gateway', 'nodes',
    'hooks', 'webhooks', 'agents_list'
  ];
  return unusedTools.length > 0 ? unusedTools : knownUnused;
}

// Apply optimizations and return changes
export function applyOptimizations(
  suggestions: OptimizationSuggestion[],
  config: OptimizerConfig
): SnapshotChange[] {
  const changes: SnapshotChange[] = [];

  for (const s of suggestions) {
    if (s.category === 'workspace-file' && s.file) {
      const filePath = path.join(config.workspaceDir, s.file);
      if (fs.existsSync(filePath)) {
        const change = optimizeWorkspaceFile(filePath, s);
        changes.push(change);
      }
    }
  }

  return changes;
}

// Git operations for version control
export function ensureGitRepo(workspaceDir: string): boolean {
  const gitDir = path.join(workspaceDir, '.git');
  if (!fs.existsSync(gitDir)) {
    try {
      child.execSync('git init', { cwd: workspaceDir, stdio: 'pipe' });
      child.execSync('git add -A', { cwd: workspaceDir, stdio: 'pipe' });
      child.execSync('git commit -m "initial: context-optimizer baseline"', {
        cwd: workspaceDir,
        stdio: 'pipe'
      });
      return true;
    } catch {
      return false;
    }
  }
  return true;
}

export function createSnapshotCommit(
  workspaceDir: string,
  label: string,
  changes: SnapshotChange[]
): string | null {
  try {
    const changeSummary = changes.map(c =>
      `${c.file}: ${c.beforeChars} → ${c.afterChars} chars`
    ).join('\n');

    child.execSync('git add -A', { cwd: workspaceDir, stdio: 'pipe' });
    child.execSync(
      `git commit -m "context-optimizer: ${label}\n\nChanges:\n${changeSummary}"`,
      { cwd: workspaceDir, stdio: 'pipe' }
    );
    const hash = child.execSync('git rev-parse HEAD', {
      cwd: workspaceDir,
      stdio: 'pipe'
    }).toString().trim();
    return hash;
  } catch {
    return null;
  }
}

export function rollbackToCommit(
  workspaceDir: string,
  commitHash: string
): boolean {
  try {
    child.execSync(`git reset --hard ${commitHash}`, {
      cwd: workspaceDir,
      stdio: 'pipe'
    });
    return true;
  } catch {
    return false;
  }
}

export function getGitHistory(workspaceDir: string): Array<{hash: string; message: string; date: string}> {
  try {
    const output = child.execSync(
      'git log --oneline --format="%h %s %ai" -20',
      { cwd: workspaceDir, stdio: 'pipe' }
    ).toString();

    return output.split('\n').filter(Boolean).map(line => {
      const parts = line.split(' ');
      return {
        hash: parts[0] || '',
        message: parts.slice(1, -2).join(' '),
        date: parts.slice(-2).join(' ')
      };
    });
  } catch {
    return [];
  }
}
