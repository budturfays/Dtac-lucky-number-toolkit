"""deploy_guard.py — prevent accidental cross-project Vercel deploys.

The repo has TWO Vercel projects that must NEVER be deployed from the wrong
directory:
  - webapp/            -> project "lucky-number-web"   (static site, dist/)
  - vercel-fn/         -> project "lucky-number-buy"   (serverless buy function)

A `vercel deploy --prebuilt` from the wrong folder (or with stale .vercel
project link) silently produces a static build with NO serverless function,
which breaks /api/buy (the earlier 404 incident).

This guard verifies the target project matches the directory before deploy.
VERCEL_BIN (optional) overrides the vercel command, e.g.
  VERCEL_BIN="npx --yes vercel@58" python deploy_guard.py webapp --prebuilt

Usage (from repo root):
  python deploy_guard.py webapp            # deploys webapp -> lucky-number-web
  python deploy_guard.py vercel-fn         # deploys vercel-fn -> lucky-number-buy
  python deploy_guard.py --check           # just verify mappings, no deploy
"""
import json
import os
import shlex
import shutil
import subprocess
import sys

REPO = os.path.dirname(os.path.abspath(__file__))
# directory -> (project id, project name)
# project id is what .vercel/project.json stores; name is for messages.
PROJECTS = {
    "webapp": ("prj_TXjIz88GHbYRw85KSKtaX3vdLzVA", "lucky-number-web"),
    "vercel-fn": ("prj_DTqOVC4UCMSLDXQmuV1IEvPCE8Fn", "lucky-number-buy"),
}


def read_project_link(directory):
    """Read the linked project ID from <dir>/.vercel/project.json if present."""
    pj = os.path.join(REPO, directory, ".vercel", "project.json")
    if not os.path.exists(pj):
        return None
    with open(pj, encoding="utf-8") as f:
        data = json.load(f)
    return data.get("projectId")


def main():
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help"):
        print(__doc__)
        sys.exit(0)
    if args[0] == "--check":
        for d, (pid, name) in PROJECTS.items():
            link = read_project_link(d)
            ok = link and link == pid
            print(f"{d}: linked={link} expected={name} ({pid}) "
                  f"{'OK' if ok else 'MISMATCH/UNLINKED'}")
        sys.exit(0)

    directory = args[0]
    if directory not in PROJECTS:
        sys.exit(f"Unknown target '{directory}'. Use one of: {list(PROJECTS)}")

    pid, name = PROJECTS[directory]
    link = read_project_link(directory)
    if not link:
        print(f"[guard] {directory} has no .vercel link — run 'vercel link' "
              f"inside {directory} first (project {name}).")
        sys.exit(1)
    if link != pid:
        sys.exit(f"[guard] MISMATCH: {directory} is linked to project ID '{link}', "
                 f"expected '{name}' ({pid}). Refusing to deploy — fix the link first.")

    print(f"[guard] OK: deploying {directory} -> {name}")
    extra = args[1:]
    # Allow CI to pin the vercel binary (e.g. VERCEL_BIN="npx --yes vercel@58").
    vercel_bin = shlex.split(os.environ.get("VERCEL_BIN", "vercel"))
    cmd = vercel_bin + ["deploy", "--prod", "--yes"] + extra
    # Windows npm shims are .cmd files, which CreateProcess can't run directly.
    first = shutil.which(cmd[0]) or cmd[0]
    if first.lower().endswith((".cmd", ".bat")):
        comspec = os.environ.get("COMSPEC", "cmd.exe")
        cmd = [comspec, "/c", first] + cmd[1:]
    rc = subprocess.call(cmd, cwd=os.path.join(REPO, directory))
    sys.exit(rc)


if __name__ == "__main__":
    main()
