// ============================================================
// Analyzer - calculates token usage across all context sections
// ============================================================
import * as fs from 'fs';
import * as path from 'path';
import { AnalysisResult, TokenBreakdown, OptimizationSuggestion, OptimizerConfig } from './types.js';

// Rough char-to-token conversion (4 chars ≈ 1 token for English, varies for CJK)
function charsToTokens(chars: number): number {
  // Conservative estimate: 3.5 chars per token average
  return Math.ceil(chars / 3.5);
}

function getStatus(percentage: number, threshold: number): 'optimal' | 'warning' | 'critical' {
  if (percentage > threshold * 0.7) return 'critical';
  if (percentage > threshold * 0.4) return 'warning';
  return 'optimal';
}

// Analyze workspace bootstrap files (AGENTS.md, SOUL.md, etc.)
function analyzeWorkspaceFiles(workspaceDir: string): TokenBreakdown[] {
  const bootstrapFiles = [
    'AGENTS.md', 'SOUL.md', 'TOOLS.md', 'IDENTITY.md',
    'USER.md', 'HEARTBEAT.md', 'BOOTSTRAP.md'
  ];
  const results: TokenBreakdown[] = [];
  let totalChars = 0;

  for (const file of bootstrapFiles) {
    const filePath = path.join(workspaceDir, file);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const chars = content.length;
      totalChars += chars;
      const tokens = charsToTokens(chars);
      results.push({
        section: `workspace:${file}`,
        chars,
        estimatedTokens: tokens,
        percentage: 0, // calculated later
        status: chars > 10000 ? 'critical' : chars > 5000 ? 'warning' : 'optimal',
        suggestion: chars > 10000 ? `File is large (${chars} chars). Consider splitting or summarizing.` : undefined
      });
    }
  }

  return results;
}

// Analyze tool schemas (estimate based on tool list)
function analyzeToolSchemas(workspaceDir: string, config: OptimizerConfig): TokenBreakdown {
  const distDir = '/opt/homebrew/lib/node_modules/openclaw/dist';
  const piToolsPath = path.join(distDir, 'pi-tools-DSzv5qcy.js');
  const openclawToolsPath = path.join(distDir, 'openclaw-tools-BIHCDPUL.js');

  let totalSchemaChars = 0;

  // Count schema content by analyzing the bundled files
  if (fs.existsSync(piToolsPath)) {
    const content = fs.readFileSync(piToolsPath, 'utf-8');
    // Approximate: count description strings in tool definitions
    const descMatches = content.match(/description:\s*"[^"]*"/g) || [];
    totalSchemaChars += descMatches.reduce((sum, d) => sum + d.length, 0);
    // Add structural overhead (~2x description length)
    totalSchemaChars *= 2;
  }

  if (fs.existsSync(openclawToolsPath)) {
    const content = fs.readFileSync(openclawToolsPath, 'utf-8');
    const descMatches = content.match(/description:\s*"[^"]*"/g) || [];
    totalSchemaChars += descMatches.reduce((sum, d) => sum + d.length, 0) * 2;
  }

  // If we couldn't calculate, use documented default (~32,000 chars)
  if (totalSchemaChars < 1000) {
    totalSchemaChars = 32000;
  }

  return {
    section: 'tool-schemas',
    chars: totalSchemaChars,
    estimatedTokens: charsToTokens(totalSchemaChars),
    percentage: 0,
    status: totalSchemaChars > 40000 ? 'critical' : totalSchemaChars > 25000 ? 'warning' : 'optimal',
    suggestion: `Tool schemas take ${totalSchemaChars.toLocaleString()} chars. Consider removing unused tools via tools.deny config.`
  };
}

// Analyze skill list
function analyzeSkillList(workspaceDir: string): TokenBreakdown {
  const skillsDir = path.join(workspaceDir.replace('/workspace', ''), 'openclaw/skills');
  let totalChars = 0;
  let skillCount = 0;

  if (fs.existsSync(skillsDir)) {
    const skills = fs.readdirSync(skillsDir, { withFileTypes: true });
    for (const skill of skills) {
      if (skill.isDirectory()) {
        const skillFile = path.join(skillsDir, skill.name, 'SKILL.md');
        if (fs.existsSync(skillFile)) {
          const content = fs.readFileSync(skillFile, 'utf-8');
          totalChars += content.length;
          skillCount++;
        }
      }
    }
  }

  // Skills list in system prompt is just metadata, not full content
  // Approximate: 50 chars per skill entry in the list
  const listChars = skillCount * 50;

  return {
    section: 'skills-list',
    chars: listChars,
    estimatedTokens: charsToTokens(listChars),
    percentage: 0,
    status: skillCount > 15 ? 'warning' : 'optimal',
    suggestion: skillCount > 15 ? `${skillCount} skills registered. Each adds ~50 chars to system prompt.` : undefined
  };
}

// Analyze system prompt sections
function analyzeSystemPrompt(workspaceDir: string): TokenBreakdown {
  // System prompt includes: tool list, skills list, runtime info, AGENTS.md etc.
  // Approximate base system prompt (without workspace files)
  const baseChars = 15000; // rough estimate from docs

  return {
    section: 'system-prompt-base',
    chars: baseChars,
    estimatedTokens: charsToTokens(baseChars),
    percentage: 0,
    status: 'optimal',
    suggestion: 'Base system prompt includes tool list, skills metadata, runtime info.'
  };
}

// Analyze session history
function analyzeSessionHistory(workspaceDir: string): TokenBreakdown {
  // We can't directly count session tokens without API access
  // Estimate based on session store if available
  const sessionPath = path.join(process.env.HOME || '', '.openclaw/sessions');
  let totalChars = 0;

  if (fs.existsSync(sessionPath)) {
    try {
      const sessions = fs.readdirSync(sessionPath);
      // Count current session history chars
      // This is an approximation
      totalChars = 50000; // rough default
    } catch {
      totalChars = 50000;
    }
  }

  return {
    section: 'session-history',
    chars: totalChars,
    estimatedTokens: charsToTokens(totalChars),
    percentage: 0,
    status: totalChars > 200000 ? 'critical' : totalChars > 100000 ? 'warning' : 'optimal',
    suggestion: 'Long session history increases token usage. Use /compact to summarize.'
  };
}

// Generate optimization suggestions
function generateSuggestions(
  breakdown: TokenBreakdown[],
  workspaceDir: string
): OptimizationSuggestion[] {
  const suggestions: OptimizationSuggestion[] = [];

  // Check for large workspace files
  for (const item of breakdown) {
    if (item.section.startsWith('workspace:') && item.chars > 10000) {
      const fileName = item.section.split(':')[1];
      suggestions.push({
        id: `ws-trim-${fileName}`,
        title: `Trim ${fileName}`,
        description: `${fileName} is ${item.chars.toLocaleString()} chars. Summarize or split to reduce context overhead.`,
        impact: item.chars > 30000 ? 'high' : 'medium',
        estimatedSavings: Math.floor(item.chars * 0.5),
        category: 'workspace-file',
        file: fileName,
        action: 'optimize'
      });
    }
  }

  // Check for tool schema bloat
  const toolSchema = breakdown.find(b => b.section === 'tool-schemas');
  if (toolSchema && toolSchema.chars > 30000) {
    suggestions.push({
      id: 'tool-prune',
      title: 'Prune unused tool schemas',
      description: `Tool schemas use ${toolSchema.chars.toLocaleString()} chars. Remove unused tools to save ~${Math.floor(toolSchema.chars * 0.3).toLocaleString()} chars.`,
      impact: 'high',
      estimatedSavings: Math.floor(toolSchema.chars * 0.3),
      category: 'tool-schema',
      action: 'prune'
    });
  }

  // Suggest context pruning
  suggestions.push({
    id: 'ctx-pruning',
    title: 'Enable context pruning',
    description: 'Pruning removes old tool results from context before each LLM call. Reduces bloat without rewriting transcript.',
    impact: 'high',
    estimatedSavings: 10000,
    category: 'config',
    action: 'optimize'
  });

  // Suggest memory flush tuning
  suggestions.push({
    id: 'memory-flush',
    title: 'Tune memory flush threshold',
    description: 'Lower reserveTokensFloor to trigger memory flush earlier, ensuring important context is saved before compaction.',
    impact: 'medium',
    estimatedSavings: 0, // indirect benefit
    category: 'config',
    action: 'optimize'
  });

  return suggestions;
}

// Main analysis function
export function analyzeContext(config: OptimizerConfig): AnalysisResult {
  const workspaceDir = config.workspaceDir;

  const sections = [
    analyzeSystemPrompt(workspaceDir),
    analyzeToolSchemas(workspaceDir, config),
    analyzeSkillList(workspaceDir),
    ...analyzeWorkspaceFiles(workspaceDir),
    analyzeSessionHistory(workspaceDir)
  ];

  const totalChars = sections.reduce((sum, s) => sum + s.chars, 0);
  const totalTokens = charsToTokens(totalChars);
  const contextWindow = config.contextWindow || 300000;

  // Calculate percentages and status
  const breakdown = sections.map(s => ({
    ...s,
    percentage: (s.chars / totalChars) * 100,
    status: s.status || getStatus(s.chars / contextWindow, 1)
  }));

  const optimizations = generateSuggestions(breakdown, workspaceDir);

  return {
    totalChars,
    totalTokens,
    contextWindow,
    usagePercent: (totalChars / (contextWindow * 3.5)) * 100, // rough token estimate
    breakdown,
    optimizations,
    timestamp: new Date().toISOString()
  };
}
