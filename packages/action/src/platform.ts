import { COMMENT_MARKER } from "@plumbline/core";

export type FetchLike = typeof fetch;

/**
 * Everything Plumbline can do to a PR or MR.
 * There is deliberately no approve, merge, assign, request-review or dismiss operation.
 */
export interface Platform {
  name: "github" | "gitlab";
  upsertComment(body: string): Promise<"created" | "updated">;
  setLabel(label: string, present: boolean): Promise<void>;
}

const MAX_COMMENT = 60000;

export function truncateComment(body: string): string {
  if (body.length <= MAX_COMMENT) return body;
  const note = "\n\n_Report truncated. The full report is in the job artifacts._\n";
  return body.slice(0, MAX_COMMENT - note.length) + note;
}

class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request(fetcher: FetchLike, url: string, init: RequestInit, ok: number[] = []): Promise<unknown> {
  const res = await fetcher(url, init);
  if (!res.ok && !ok.includes(res.status)) {
    // Only the path is reported, so a log never shows query values or tokens.
    throw new ApiError(res.status, `${init.method ?? "GET"} ${new URL(url).pathname} failed with ${res.status}`);
  }
  if (res.status === 204 || !res.ok) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

interface Comment {
  id: number;
  body?: string;
  user?: { login?: string };
  author?: { username?: string };
}

/** Our comment is the one we wrote with the marker. Anyone can paste the marker, so the author must match too. */
function findOwn(comments: Comment[], author: string | null, authorOf: (c: Comment) => string | undefined): Comment | undefined {
  return comments.find((c) => c.body?.startsWith(COMMENT_MARKER) && author !== null && authorOf(c) === author);
}

export interface GitHubConfig {
  apiUrl: string;
  repo: string;
  number: number;
  token: string;
  fetcher?: FetchLike;
}

export function github(cfg: GitHubConfig): Platform {
  const fetcher = cfg.fetcher ?? fetch;
  const base = `${cfg.apiUrl.replace(/\/$/, "")}/repos/${cfg.repo}`;
  const headers = {
    Authorization: `Bearer ${cfg.token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
    "User-Agent": "plumbline-action",
  };
  const call = (url: string, init: RequestInit = {}, ok: number[] = []) => request(fetcher, url, { ...init, headers }, ok);

  async function self(): Promise<string> {
    // The default GITHUB_TOKEN cannot read /user, and always comments as this bot.
    const me = (await call(`${cfg.apiUrl.replace(/\/$/, "")}/user`, {}, [401, 403])) as { login?: string } | null;
    return me?.login ?? "github-actions[bot]";
  }

  return {
    name: "github",
    async upsertComment(body) {
      const author = await self();
      const all: Comment[] = [];
      for (let page = 1; page <= 20; page++) {
        const batch = (await call(`${base}/issues/${cfg.number}/comments?per_page=100&page=${page}`)) as Comment[];
        all.push(...batch);
        if (batch.length < 100) break;
      }
      const own = findOwn(all, author, (c) => c.user?.login);
      const payload = JSON.stringify({ body: truncateComment(body) });
      if (own) {
        await call(`${base}/issues/comments/${own.id}`, { method: "PATCH", body: payload });
        return "updated";
      }
      await call(`${base}/issues/${cfg.number}/comments`, { method: "POST", body: payload });
      return "created";
    },
    async setLabel(label, present) {
      if (present) {
        await call(`${base}/labels`, { method: "POST", body: JSON.stringify({ name: label, color: "6EE7C8" }) }, [422]);
        await call(`${base}/issues/${cfg.number}/labels`, { method: "POST", body: JSON.stringify({ labels: [label] }) });
      } else {
        await call(`${base}/issues/${cfg.number}/labels/${encodeURIComponent(label)}`, { method: "DELETE" }, [404]);
      }
    },
  };
}

export interface GitLabConfig {
  /** From CI_API_V4_URL, so self-managed GitLab works. */
  apiUrl: string;
  projectId: string;
  iid: number;
  token: string;
  fetcher?: FetchLike;
}

export function gitlab(cfg: GitLabConfig): Platform {
  const fetcher = cfg.fetcher ?? fetch;
  const api = cfg.apiUrl.replace(/\/$/, "");
  const mr = `${api}/projects/${encodeURIComponent(cfg.projectId)}/merge_requests/${cfg.iid}`;
  const headers = { "PRIVATE-TOKEN": cfg.token, "Content-Type": "application/json" };
  const call = (url: string, init: RequestInit = {}) => request(fetcher, url, { ...init, headers });

  return {
    name: "gitlab",
    async upsertComment(body) {
      const me = (await call(`${api}/user`)) as { username?: string };
      const all: Comment[] = [];
      for (let page = 1; page <= 20; page++) {
        const batch = (await call(`${mr}/notes?per_page=100&page=${page}`)) as Comment[];
        all.push(...batch);
        if (batch.length < 100) break;
      }
      const own = findOwn(all, me.username ?? null, (c) => c.author?.username);
      const payload = JSON.stringify({ body: truncateComment(body) });
      if (own) {
        await call(`${mr}/notes/${own.id}`, { method: "PUT", body: payload });
        return "updated";
      }
      await call(`${mr}/notes`, { method: "POST", body: payload });
      return "created";
    },
    async setLabel(label, present) {
      const change = present ? { add_labels: label } : { remove_labels: label };
      await call(mr, { method: "PUT", body: JSON.stringify(change) });
    },
  };
}
