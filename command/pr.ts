import { git, getCurrentBranch, getRemoteInfo } from "./utils";
import { prompt, promptPrefilled, select } from "./prompts";

function shellConfigFile(): string {
  const shell = process.env.SHELL ?? "";
  if (shell.includes("zsh")) return "~/.zshrc";
  if (shell.includes("fish")) return "~/.config/fish/config.fish";
  return "~/.bashrc";
}

async function getAllBranches(): Promise<string[]> {
  const localOut = await git("branch", "--format=%(refname:short)");
  const remoteOut = await git("branch", "-r", "--format=%(refname:short)");

  const local = localOut.split("\n").filter(Boolean);
  const localSet = new Set(local);
  const remote = remoteOut
    .split("\n")
    .filter(Boolean)
    .map((b) => b.replace(/^origin\//, ""))
    .filter((b) => b !== "HEAD" && !localSet.has(b));

  return [...local, ...remote];
}

const PREFERRED_BASE_BRANCHES = ["main", "master", "staging", "develop", "dev"];

export async function prCmd(flags: Record<string, string>) {
  let remoteInfo: Awaited<ReturnType<typeof getRemoteInfo>>;
  try {
    remoteInfo = await getRemoteInfo();
  } catch (e: any) {
    console.error(`\x1b[31mError:\x1b[0m ${e.message}`);
    process.exit(1);
  }

  const { provider, owner, repo } = remoteInfo;

  let authHeader: string;
  let gitlabToken: string | undefined;

  if (provider === "github") {
    const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
    if (!token) {
      const rc = shellConfigFile();
      console.error("\x1b[31mNo GitHub token found.\x1b[0m");
      console.error("");
      console.error("  1. Go to \x1b[36mhttps://github.com/settings/tokens/new\x1b[0m");
      console.error("  2. Select scopes: \x1b[1mrepo\x1b[0m (or \x1b[1mpublic_repo\x1b[0m for public repos)");
      console.error(`  3. Add to \x1b[36m${rc}\x1b[0m:`);
      console.error("     \x1b[2mexport GITHUB_TOKEN=your_token_here\x1b[0m");
      process.exit(1);
    }
    authHeader = `token ${token}`;
  } else if (provider === "gitlab") {
    gitlabToken = process.env.GITLAB_TOKEN ?? process.env.GL_TOKEN;
    if (!gitlabToken) {
      const rc = shellConfigFile();
      console.error("\x1b[31mNo GitLab token found.\x1b[0m");
      console.error("");
      console.error("  1. Go to \x1b[36mhttps://gitlab.com/-/user_settings/personal_access_tokens\x1b[0m");
      console.error("  2. Select scopes: \x1b[1mapi\x1b[0m");
      console.error(`  3. Add to \x1b[36m${rc}\x1b[0m:`);
      console.error("     \x1b[2mexport GITLAB_TOKEN=your_token_here\x1b[0m");
      process.exit(1);
    }
    authHeader = `Bearer ${gitlabToken}`;
  } else {
    const token = process.env.BITBUCKET_TOKEN;
    const bbUser = process.env.BITBUCKET_USERNAME;
    const bbPass = process.env.BITBUCKET_APP_PASSWORD;
    if (!token && !(bbUser && bbPass)) {
      const rc = shellConfigFile();
      console.error("\x1b[31mNo Bitbucket credentials found.\x1b[0m");
      console.error("");
      console.error("  Option A — App password (recommended):");
      console.error("  1. Go to \x1b[36mhttps://bitbucket.org/account/settings/app-passwords/new\x1b[0m");
      console.error("  2. Select scopes: \x1b[1mPull requests: write\x1b[0m");
      console.error(`  3. Add to \x1b[36m${rc}\x1b[0m:`);
      console.error("     \x1b[2mexport BITBUCKET_USERNAME=your_username\x1b[0m");
      console.error("     \x1b[2mexport BITBUCKET_APP_PASSWORD=your_app_password\x1b[0m");
      console.error("");
      console.error("  Option B — Repository access token:");
      console.error(`  Add to \x1b[36m${rc}\x1b[0m:`);
      console.error("     \x1b[2mexport BITBUCKET_TOKEN=your_token_here\x1b[0m");
      process.exit(1);
    }
    authHeader = token
      ? `Bearer ${token}`
      : `Basic ${Buffer.from(`${bbUser}:${bbPass}`).toString("base64")}`;
  }

  const current = await getCurrentBranch();
  const allBranches = await getAllBranches();

  // Source branch: current first, then everything else
  let branch: string;
  if (flags["from"] ?? flags["head"]) {
    branch = (flags["from"] ?? flags["head"])!;
  } else {
    const fromOptions = [current, ...allBranches.filter((b) => b !== current)];
    branch = await select("Your branch (head):", fromOptions);
  }

  // Target branch: preferred bases first, then remainder (excluding source)
  let base: string;
  if (flags["base"] ?? flags["b"]) {
    base = (flags["base"] ?? flags["b"])!;
  } else {
    const preferred = PREFERRED_BASE_BRANCHES.filter((b) => allBranches.includes(b) && b !== branch);
    const rest = allBranches.filter((b) => !PREFERRED_BASE_BRANCHES.includes(b) && b !== branch);
    const baseOptions = [...preferred, ...rest];
    if (baseOptions.length === 0) {
      console.error("\x1b[31mError:\x1b[0m No valid target branches found.");
      process.exit(1);
    }
    base = await select("Base branch (merge target):", baseOptions);
  }

  const isDraft = "draft" in flags;

  // Ensure the head branch exists on the remote before hitting the API
  let hasUpstream = true;
  try {
    await git("rev-parse", "--abbrev-ref", `${branch}@{upstream}`);
  } catch {
    hasUpstream = false;
  }
  if (!hasUpstream) {
    console.log(`\x1b[33mBranch \x1b[36m${branch}\x1b[33m has no remote — pushing now...\x1b[0m`);
    await git("push", "-u", "origin", branch);
    console.log(`\x1b[32mPushed.\x1b[0m`);
  }

  const lastSubject = await git("log", "-1", "--format=%s");
  const title =
    flags["title"] ?? flags["t"] ?? (await promptPrefilled("PR title:", lastSubject));
  if (!title) {
    console.error("Title is required.");
    process.exit(1);
  }

  const body = flags["body"] ?? flags["d"] ?? (await prompt("Description (optional):"));

  const label = provider === "gitlab" ? "merge request" : "pull request";
  console.log(
    `\nCreating ${label} on \x1b[36m${provider}\x1b[0m (\x1b[36m${owner}/${repo}\x1b[0m)...`,
  );

  if (provider === "github") {
    await createGitHubPR({ owner, repo, branch, base, title, body, isDraft, authHeader });
  } else if (provider === "gitlab") {
    await createGitLabMR({ owner, repo, branch, base, title, body, isDraft, token: gitlabToken! });
  } else {
    await createBitbucketPR({ owner, repo, branch, base, title, body, authHeader });
  }
}

interface PRParams {
  owner: string;
  repo: string;
  branch: string;
  base: string;
  title: string;
  body: string;
  isDraft: boolean;
  authHeader: string;
}

async function createGitHubPR({ owner, repo, branch, base, title, body, isDraft, authHeader }: PRParams) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ title, body, head: branch, base, draft: isDraft }),
  });

  if (!res.ok) {
    const err = (await res.json()) as any;
    console.error(`\x1b[31mFailed (${res.status}):\x1b[0m ${err.message ?? res.statusText}`);
    if (Array.isArray(err.errors)) {
      for (const e of err.errors) {
        const detail = e.message ?? (e.field ? `${e.resource}.${e.field}: ${e.code}` : JSON.stringify(e));
        console.error(`  ${detail}`);
      }
    }
    process.exit(1);
  }

  const data = (await res.json()) as { html_url: string; number: number };
  console.log(`\x1b[32mCreated PR #${data.number}:\x1b[0m ${data.html_url}`);
}

async function createGitLabMR({
  owner,
  repo,
  branch,
  base,
  title,
  body,
  isDraft,
  token,
}: Omit<PRParams, "authHeader"> & { token: string }) {
  const projectPath = encodeURIComponent(`${owner}/${repo}`);
  const res = await fetch(`https://gitlab.com/api/v4/projects/${projectPath}/merge_requests`, {
    method: "POST",
    headers: {
      "PRIVATE-TOKEN": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: isDraft ? `Draft: ${title}` : title,
      description: body,
      source_branch: branch,
      target_branch: base,
    }),
  });

  if (!res.ok) {
    const err = (await res.json()) as any;
    console.error(
      `\x1b[31mFailed (${res.status}):\x1b[0m ${JSON.stringify(err.message ?? err)}`,
    );
    process.exit(1);
  }

  const data = (await res.json()) as { web_url: string; iid: number };
  console.log(`\x1b[32mCreated MR !${data.iid}:\x1b[0m ${data.web_url}`);
}

async function createBitbucketPR({
  owner,
  repo,
  branch,
  base,
  title,
  body,
  authHeader,
}: Omit<PRParams, "isDraft">) {
  const res = await fetch(
    `https://api.bitbucket.org/2.0/repositories/${owner}/${repo}/pullrequests`,
    {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title,
        description: body,
        source: { branch: { name: branch } },
        destination: { branch: { name: base } },
      }),
    },
  );

  if (!res.ok) {
    const err = (await res.json()) as any;
    console.error(
      `\x1b[31mFailed (${res.status}):\x1b[0m ${err.error?.message ?? res.statusText}`,
    );
    process.exit(1);
  }

  const data = (await res.json()) as { links: { html: { href: string } }; id: number };
  console.log(`\x1b[32mCreated PR #${data.id}:\x1b[0m ${data.links.html.href}`);
}
