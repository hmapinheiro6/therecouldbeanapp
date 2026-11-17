// Public generated files only, inside an ephemeral GitHub Actions checkout.
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
const paths = [
  "data/expansion-health.json",
  "data/seeds/published-snapshot.json",
];
if (
  process.env.GITHUB_ACTIONS !== "true" ||
  process.env.GITHUB_REPOSITORY !== "hmapinheiro6/therecouldbeanapp"
)
  throw new Error("Use the configured hosted workflow");
const token = process.env.GH_TOKEN;
if (!token) throw new Error("Missing hosted repository credential");
const auth = Buffer.from("x-access-token:" + token).toString("base64");
function git(args, allowFailure = false) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if ((result.error || result.status !== 0) && !allowFailure) {
    const diagnostic = (result.stderr || "")
      .replaceAll(token, "[redacted]")
      .replaceAll(auth, "[redacted]");
    throw new Error(
      "Public expansion publication failed: " + diagnostic.slice(-2000),
    );
  }
  return result;
}
const copies = new Map();
for (const path of paths) {
  if (
    !existsSync(path) ||
    !git(["status", "--porcelain", "--", path]).stdout.trim()
  )
    continue;
  copies.set(path, readFileSync(path));
  if (git(["ls-files", "--error-unmatch", path], true).status === 0)
    git(["restore", "--source=HEAD", "--", path]);
  else unlinkSync(path); // Generated public copy is retained in memory below.
}
if (!copies.size) process.exit(0);
// Refresh BEFORE making the data commit. A queued workflow may have started
// from an older SHA; rebasing conflicting aggregate JSON cannot merge counts.
const network = ["-c", "http.extraheader=AUTHORIZATION: basic " + auth];
git([...network, "fetch", "origin", "main"]);
git(["merge", "--ff-only", "origin/main"]);
for (const [path, bytes] of copies) writeFileSync(path, bytes);
git(["add", "--", ...copies.keys()]);
if (git(["diff", "--cached", "--quiet"], true).status === 0) process.exit(0);
git(["config", "user.name", "github-actions[bot]"]);
git([
  "config",
  "user.email",
  "41898282+github-actions[bot]@users.noreply.github.com",
]);
git(["commit", "-m", "Update hosted catalog expansion progress"]);
for (let attempt = 0; attempt < 3; attempt++) {
  if (git([...network, "push", "origin", "HEAD:main"], true).status === 0) {
    console.log(
      JSON.stringify({
        public_expansion_files: [...copies.keys()],
        published: true,
      }),
    );
    process.exit(0);
  }
  git([...network, "pull", "--rebase", "origin", "main"]);
}
throw new Error("Public progress push still failed after bounded retries");
