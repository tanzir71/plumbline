const SCM_SECRETS =
  /^(GITHUB_TOKEN|GH_TOKEN|GITLAB_TOKEN|PLUMBLINE_GITHUB_TOKEN|PLUMBLINE_GITLAB_TOKEN|PLUMBLINE_MODEL_KEY|OPENROUTER_API_KEY|CI_JOB_TOKEN|CI_JOB_JWT.*|CI_REGISTRY_PASSWORD|CI_DEPENDENCY_PROXY_PASSWORD|ACTIONS_RUNTIME_TOKEN|ACTIONS_ID_TOKEN_REQUEST_TOKEN|ACTIONS_ID_TOKEN_REQUEST_URL|NPM_TOKEN|NODE_AUTH_TOKEN)$/;

/** A review agent reads untrusted code, so it never gets source-control, registry or CI credentials. */
export function withoutScmSecrets(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(base)) if (!SCM_SECRETS.test(name)) env[name] = value;
  return env;
}
