// ============================================================
// Snapshots - manages optimization snapshots for rollback
// ============================================================
import * as fs from 'fs';
import * as path from 'path';
import { Snapshot, AnalysisResult, SnapshotChange, OptimizerConfig } from './types.js';

function getSnapshotsDir(config: OptimizerConfig): string {
  return config.snapshotsDir || path.join(config.workspaceDir, '.context-optimizer');
}

function ensureSnapshotsDir(config: OptimizerConfig): string {
  const dir = getSnapshotsDir(config);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function saveSnapshot(
  config: OptimizerConfig,
  label: string,
  analysisBefore: AnalysisResult,
  analysisAfter: AnalysisResult | undefined,
  changes: SnapshotChange[],
  gitCommit?: string,
  rollbackCommit?: string
): Snapshot {
  const dir = ensureSnapshotsDir(config);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const id = `snapshot-${timestamp}`;

  const snapshot: Snapshot = {
    id,
    timestamp: new Date().toISOString(),
    label,
    analysisBefore,
    analysisAfter,
    changes,
    gitCommit,
    rollbackCommit
  };

  const snapshotPath = path.join(dir, `${id}.json`);
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));

  // Clean up old snapshots if exceeding max
  cleanupOldSnapshots(config, config.maxSnapshots || 10);

  return snapshot;
}

export function listSnapshots(config: OptimizerConfig): Snapshot[] {
  const dir = getSnapshotsDir(config);
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const content = fs.readFileSync(path.join(dir, f), 'utf-8');
      return JSON.parse(content) as Snapshot;
    })
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

export function getSnapshot(config: OptimizerConfig, snapshotId: string): Snapshot | null {
  const dir = getSnapshotsDir(config);
  const snapshotPath = path.join(dir, `${snapshotId}.json`);
  if (!fs.existsSync(snapshotPath)) return null;

  const content = fs.readFileSync(snapshotPath, 'utf-8');
  return JSON.parse(content) as Snapshot;
}

export function getLatestSnapshot(config: OptimizerConfig): Snapshot | null {
  const snapshots = listSnapshots(config);
  return snapshots.length > 0 ? snapshots[0] : null;
}

export function deleteSnapshot(config: OptimizerConfig, snapshotId: string): boolean {
  const dir = getSnapshotsDir(config);
  const snapshotPath = path.join(dir, `${snapshotId}.json`);
  if (!fs.existsSync(snapshotPath)) return false;

  fs.unlinkSync(snapshotPath);
  return true;
}

function cleanupOldSnapshots(config: OptimizerConfig, maxSnapshots: number): void {
  const dir = getSnapshotsDir(config);
  if (!fs.existsSync(dir)) return;

  const snapshots = fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .sort();

  while (snapshots.length > maxSnapshots) {
    const oldest = snapshots.shift();
    if (oldest) {
      fs.unlinkSync(path.join(dir, oldest));
    }
  }
}

export function restoreFromSnapshot(
  config: OptimizerConfig,
  snapshotId: string
): boolean {
  const snapshot = getSnapshot(config, snapshotId);
  if (!snapshot) return false;

  // Try git rollback first
  if (snapshot.rollbackCommit) {
    // Git rollback is handled by the optimizer module
    return true;
  }

  // Manual file restoration from snapshot changes
  for (const change of snapshot.changes) {
    if (change.before !== null) {
      const filePath = path.join(config.workspaceDir, change.file);
      fs.writeFileSync(filePath, change.before, 'utf-8');
    }
  }

  return true;
}
