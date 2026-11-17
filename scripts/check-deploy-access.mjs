for (const name of ["CLOUDFLARE_API_TOKEN", "WATCHDOG_GITHUB_TOKEN"])
  if (!process.env[name])
    throw new Error(
      "Configure GitHub Actions secret " +
        name +
        ". Deployment was not attempted.",
    );
