/**
 * lib/enrichment/gitFresh.ts — a run starts only on current code (owner, batch 6: a run on a checkout that start.sh could not bring up to date).
 *   1. origin/main (GitLab, the canonical repository) is contained in HEAD — nothing newer waits there.
 *   2. The code branch on GitHub (where the changes are made) is contained in HEAD too, when GitHub can be reached.
 *   3. The commit the run is on is printed, so a wet run's log says what it ran on.
 * GIT_CHECK=off skips it (tests, a deliberate run on an older checkout).
 */
import { execFileSync } from "child_process";

const git = (args: string[]): string => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const GITHUB = process.env.CODE_REMOTE ?? "https://github.com/avivp112/alphamap-platform";
const BRANCH = process.env.CODE_BRANCH ?? "claude/alphamap-project-setup-wocluk";

export interface FreshResult { ok: boolean; commit: string; subject: string; problems: string[]; warnings: string[] }

export function checkFresh(): FreshResult {
  const problems: string[] = [], warnings: string[] = [];
  let commit = "?", subject = "";
  try { commit = git(["rev-parse", "--short", "HEAD"]); subject = git(["log", "-1", "--format=%s"]); } catch { return { ok: true, commit, subject, problems, warnings: ["not a git checkout — freshness not checked"] }; }
  try { git(["fetch", "-q", "origin", "main"]); } catch (e) { problems.push(`could not fetch origin/main (${String((e as Error).message).split("\n")[0].slice(0, 100)}) — is the checkout current? run: git pull --no-rebase origin main`); }
  if (!problems.length) {
    try {
      git(["merge-base", "--is-ancestor", "origin/main", "HEAD"]);
    } catch {
      let behind = "?"; try { behind = git(["rev-list", "--count", "HEAD..origin/main"]); } catch { /* keep ? */ }
      problems.push(`HEAD is missing ${behind} commit(s) of origin/main — local main and origin/main have diverged. run: git pull --no-rebase origin main (then resolve a conflict if any, then run again)`);
    }
  }
  try {
    const line = execFileSync("git", ["ls-remote", GITHUB, `refs/heads/${BRANCH}`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20_000 }).trim();
    const sha = line.split(/\s+/)[0];
    if (sha) {
      let have = true; try { git(["cat-file", "-e", `${sha}^{commit}`]); } catch { have = false; }
      let contained = false; if (have) { try { git(["merge-base", "--is-ancestor", sha, "HEAD"]); contained = true; } catch { contained = false; } }
      if (!contained) problems.push(`the code branch ${BRANCH} on GitHub (${sha.slice(0, 7)}) is not in HEAD. run: git fetch ${GITHUB} ${BRANCH} && git merge --no-ff FETCH_HEAD`);
    }
  } catch { warnings.push("GitHub could not be reached — the code branch was not compared"); }
  try { const dirty = git(["status", "--porcelain", "--", "lib", "scripts", "eval", "worker"]); if (dirty) warnings.push(`uncommitted changes in code/eval files: ${dirty.split("\n").slice(0, 3).join(" | ")}`); } catch { /* ignore */ }
  return { ok: problems.length === 0, commit, subject, problems, warnings };
}
