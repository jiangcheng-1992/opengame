type DispatchInput = {
  jobId: string;
};

function githubDispatchRepo(env: NodeJS.ProcessEnv = process.env) {
  const explicit = env.GITHUB_DISPATCH_REPO?.trim();
  if (explicit) return explicit;

  const owner = env.GITHUB_DISPATCH_OWNER?.trim();
  const slug = env.GITHUB_DISPATCH_REPO_SLUG?.trim();
  if (owner && slug) return `${owner}/${slug}`;

  return env.GITHUB_REPOSITORY?.trim() || "";
}

async function responseText(response: Response) {
  return (await response.text().catch(() => "")).trim();
}

export async function triggerGithubOpenGameWorkflow({ jobId }: DispatchInput) {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) {
    throw new Error("Missing GITHUB_DISPATCH_TOKEN.");
  }

  const repo = githubDispatchRepo();
  if (!repo || !repo.includes("/")) {
    throw new Error("Missing GITHUB_DISPATCH_REPO, expected owner/repo.");
  }

  const workflow = process.env.GITHUB_DISPATCH_WORKFLOW?.trim() || "opengame-generate.yml";
  const ref = process.env.GITHUB_DISPATCH_REF?.trim() || "main";
  const url = `https://api.github.com/repos/${repo}/actions/workflows/${encodeURIComponent(
    workflow,
  )}/dispatches`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      ref,
      inputs: {
        job_id: jobId,
      },
    }),
  });

  if (!response.ok) {
    const detail = await responseText(response);
    throw new Error(
      [
        `GitHub Actions workflow dispatch failed with HTTP ${response.status}.`,
        detail ? detail.slice(0, 1200) : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return { repo, workflow, ref };
}

export async function maybeTriggerGithubOpenGameWorkflow(input: DispatchInput) {
  if (!process.env.GITHUB_DISPATCH_TOKEN) return null;
  return triggerGithubOpenGameWorkflow(input);
}
