import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = join(root, "public", "vcs-data.json");

function git(args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function safeGit(args, fallback = "") {
  try {
    return git(args);
  } catch {
    return fallback;
  }
}

const logFormat = "%x1e%H%x1f%P%x1f%D%x1f%an%x1f%ae%x1f%ad%x1f%s";
const rawLog = safeGit([
  "log",
  "--all",
  "--topo-order",
  "--date=iso-strict",
  `--pretty=format:${logFormat}`,
  "--numstat"
]);

const commits = rawLog
  .split("\x1e")
  .map((record) => record.trim())
  .filter(Boolean)
  .map((record) => {
    const [header = "", ...numstatLines] = record.split("\n");
    const [hash, parentsRaw, refsRaw, author, email, date, ...subjectParts] = header.split("\x1f");
    const files = numstatLines
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [addedRaw, deletedRaw, path] = line.split("\t");
        return {
          path,
          added: addedRaw === "-" ? 0 : Number(addedRaw),
          deleted: deletedRaw === "-" ? 0 : Number(deletedRaw)
        };
      });

    return {
      hash,
      shortHash: hash.slice(0, 7),
      parents: parentsRaw ? parentsRaw.split(" ").filter(Boolean) : [],
      refs: refsRaw
        ? refsRaw
            .split(",")
            .map((ref) => ref.trim().replace(/^HEAD -> /, ""))
            .filter(Boolean)
        : [],
      author: {
        name: author,
        email
      },
      email,
      date,
      subject: subjectParts.join("\x1f"),
      files,
      totals: files.reduce(
        (totals, file) => {
          totals.files += 1;
          totals.added += file.added;
          totals.deleted += file.deleted;
          return totals;
        },
        { files: 0, added: 0, deleted: 0 }
      )
    };
  });

const branches = safeGit(["for-each-ref", "--format=%(refname:short)|%(objectname:short)", "refs/heads", "refs/remotes"])
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [name, target] = line.split("|");
    return { name, target };
  });

const data = {
  generatedAt: new Date().toISOString(),
  repository: safeGit(["config", "--get", "remote.origin.url"], "local"),
  currentBranch: safeGit(["branch", "--show-current"], "main"),
  commits,
  branches
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(data, null, 2)}\n`);
console.log(`Wrote ${commits.length} commits to public/vcs-data.json`);
