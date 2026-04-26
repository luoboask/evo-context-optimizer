// ============================================================
// Types for context-optimizer plugin
// ============================================================

export interface TokenBreakdown {
  section: string;
  chars: number;
  estimatedTokens: number;
  percentage: number;
  status: 'optimal' | 'warning' | 'critical';
  suggestion?: string;
}

export interface AnalysisResult {
  totalChars: number;
  totalTokens: number;
  contextWindow: number;
  usagePercent: number;
  breakdown: TokenBreakdown[];
  optimizations: OptimizationSuggestion[];
  timestamp: string;
}

export interface OptimizationSuggestion {
  id: string;
  title: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
  estimatedSavings: number; // chars
  category: 'tool-schema' | 'workspace-file' | 'session' | 'plugin' | 'config';
  file?: string;
  action: 'remove' | 'prune' | 'compress' | 'optimize' | 'disable';
}

export interface Snapshot {
  id: string;
  timestamp: string;
  label: string;
  analysisBefore: AnalysisResult;
  analysisAfter?: AnalysisResult;
  changes: SnapshotChange[];
  gitCommit?: string;
  rollbackCommit?: string;
}

export interface SnapshotChange {
  file: string;
  action: 'modify' | 'delete' | 'create';
  before: string | null;
  after: string | null;
  beforeChars: number;
  afterChars: number;
}

export interface OptimizerConfig {
  workspaceDir: string;
  snapshotsDir: string;
  maxSnapshots: number;
  autoGitInit: boolean;
  contextWindow: number;
}
