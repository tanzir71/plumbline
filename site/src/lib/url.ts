const BASE = import.meta.env.BASE_URL.replace(/\/?$/, "/");

/** Every internal link and asset goes through this, so the site works under any base path. */
export function url(path = ""): string {
  return `${BASE}${path.replace(/^\//, "")}`;
}

export const REPO = "https://github.com/tanzir71/plumbline";
export const repoFile = (path: string) => `${REPO}/blob/main/${path}`;
