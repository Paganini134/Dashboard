import { createGitgraph, Mode, Orientation, TemplateName } from "@gitgraph/js";
import "./vcs.css";

type VcsFile = {
  path: string;
  added: number;
  deleted: number;
};

type VcsCommit = {
  hash: string;
  shortHash: string;
  parents: string[];
  refs: string[];
  author: {
    name: string;
    email: string;
  };
  date: string;
  subject: string;
  files: VcsFile[];
  totals: {
    files: number;
    added: number;
    deleted: number;
  };
};

type VcsData = {
  generatedAt: string;
  repository: string;
  currentBranch: string;
  commits: VcsCommit[];
};

const app = document.querySelector<HTMLDivElement>("#vcs-app");
if (!app) throw new Error("Missing vcs app root");

app.innerHTML = `
  <main class="shell">
    <header class="toolbar">
      <a class="back" href="./">Game</a>
      <div>
        <h1>Version Graph</h1>
        <p id="summary">Loading repository history...</p>
      </div>
      <input id="filter" type="search" placeholder="Search commits or files" />
    </header>
    <section class="workspace">
      <div class="graph-wrap"><div id="graph"></div></div>
      <aside class="panel">
        <div id="details"></div>
        <div class="timeline" id="timeline"></div>
      </aside>
    </section>
  </main>
`;

const graphEl = document.querySelector<HTMLDivElement>("#graph")!;
const detailsEl = document.querySelector<HTMLDivElement>("#details")!;
const timelineEl = document.querySelector<HTMLDivElement>("#timeline")!;
const summaryEl = document.querySelector<HTMLParagraphElement>("#summary")!;
const filterEl = document.querySelector<HTMLInputElement>("#filter")!;

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return entities[char];
  });
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function matches(commit: VcsCommit, query: string) {
  const searchable = [
    commit.hash,
    commit.subject,
    commit.author.name,
    commit.refs.join(" "),
    commit.files.map((file) => file.path).join(" ")
  ]
    .join(" ")
    .toLowerCase();

  return searchable.includes(query.toLowerCase());
}

function showCommit(commit: VcsCommit) {
  const refs = commit.refs.length
    ? `<div class="refs">${commit.refs.map((ref) => `<span>${escapeHtml(ref)}</span>`).join("")}</div>`
    : "";

  const files = commit.files
    .slice(0, 14)
    .map(
      (file) => `
        <li>
          <span>${escapeHtml(file.path)}</span>
          <strong>+${file.added} -${file.deleted}</strong>
        </li>
      `
    )
    .join("");

  detailsEl.innerHTML = `
    <div class="detail-card">
      <div class="hash">${commit.shortHash}</div>
      <h2>${escapeHtml(commit.subject)}</h2>
      ${refs}
      <dl>
        <div><dt>Author</dt><dd>${escapeHtml(commit.author.name)}</dd></div>
        <div><dt>Date</dt><dd>${formatDate(commit.date)}</dd></div>
        <div><dt>Files</dt><dd>${commit.totals.files}</dd></div>
        <div><dt>Delta</dt><dd>+${commit.totals.added} -${commit.totals.deleted}</dd></div>
      </dl>
      <h3>Changed Files</h3>
      <ul class="files">${files || "<li>No file stats recorded</li>"}</ul>
    </div>
  `;
}

function renderTimeline(commits: VcsCommit[], query = "") {
  timelineEl.innerHTML = commits
    .filter((commit) => matches(commit, query))
    .map(
      (commit) => `
        <button type="button" class="commit-row" data-hash="${commit.hash}">
          <span>${commit.shortHash}</span>
          <strong>${escapeHtml(commit.subject)}</strong>
          <em>${formatDate(commit.date)}</em>
        </button>
      `
    )
    .join("");
}

async function boot() {
  const response = await fetch("./vcs-data.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`Unable to load vcs-data.json: ${response.status}`);

  const data = (await response.json()) as VcsData;
  const commits = data.commits;
  const commitByHash = new Map(commits.map((commit) => [commit.hash, commit]));

  const gitgraph = createGitgraph(graphEl, {
    orientation: Orientation.VerticalReverse,
    mode: Mode.Compact,
    template: TemplateName.Metro,
    branchLabelOnEveryCommit: false
  });
  gitgraph.import(commits);

  summaryEl.textContent = `${commits.length} commits on ${data.currentBranch} · generated ${formatDate(data.generatedAt)}`;
  renderTimeline(commits);

  timelineEl.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-hash]");
    if (!button?.dataset.hash) return;
    const commit = commitByHash.get(button.dataset.hash);
    if (commit) showCommit(commit);
  });

  filterEl.addEventListener("input", () => renderTimeline(commits, filterEl.value.trim()));

  if (commits[0]) showCommit(commits[0]);
}

boot().catch((error) => {
  detailsEl.innerHTML = `<div class="detail-card error">${escapeHtml(String(error))}</div>`;
});
