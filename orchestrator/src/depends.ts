import { isLibraryPackageRepo } from "./prerelease.js";

/** Child / plan task fields needed to evaluate depends_on. */
export type DepTaskLike = { id: string; repo: string; depends_on?: string[] };

export type DepRef = { url: string; closed: boolean };

export type DependencyContext = {
  /** Cross-repo library deps need prerelease publish+bump, not only open PR. */
  prereleaseReady?: (depTaskId: string) => boolean;
};

/**
 * When a dependency unblocks the next task:
 * - closed (merged) → always
 * - open PR → only cross-repo (package → consumer / prerelease path)
 * - library package → also needs prerelease in registry (publisher loop)
 * - same repo → wait for merge so the next chunk builds on main
 */
export function isDependencyMet(
  dep: DepRef | undefined,
  depTask: DepTaskLike | undefined,
  task: DepTaskLike,
  hasOpenPr: boolean,
  ctx: DependencyContext = {},
): boolean {
  if (!dep) return false;
  if (dep.closed) return true;
  if (depTask && depTask.repo !== task.repo) {
    if (!hasOpenPr) return false;
    if (isLibraryPackageRepo(depTask.repo)) return ctx.prereleaseReady?.(depTask.id) ?? false;
    return true;
  }
  return false;
}

export function unmetDependencyIds(
  task: DepTaskLike & { depends_on: string[] },
  planTasks: DepTaskLike[],
  resolve: (id: string) => DepRef | undefined,
  hasOpenPr: (url: string) => boolean,
  ctx: DependencyContext = {},
): string[] {
  return task.depends_on.filter((id) => {
    const depTask = planTasks.find((t) => t.id === id);
    const dep = resolve(id);
    return !isDependencyMet(dep, depTask, task, dep ? hasOpenPr(dep.url) : false, ctx);
  });
}
