---
outline: [2, 4]
---

# Host Your Web Experience

After you build a WebXR or 2D web experience for Meta Quest, host it at a publicly accessible URL. Meta Quest Browser loads the experience from that URL, the same way any browser loads a website.

This page covers what a host has to provide, names two options, then walks through one deployment with Vercel.

## Requirements

- Serve the site over HTTPS from a publicly accessible origin.
- Serve the static files that your build produces.

[Web Launch](https://developers.meta.com/horizon/documentation/web/web-launch/) accepts HTTPS targets, so an HTTPS origin also lets you send the experience to a headset.

## Choose a Host

Any host that meets the requirements works. For example:

- **GitHub Pages** publishes the static build from a repository, using [a GitHub Actions workflow](/guides/08-build-deploy#automated-deployment-with-github-actions).
- **Vercel** deploys from the command line and creates the project on the first deploy. The rest of this page walks through it.

## Deploy with Vercel

### Check the Vite Base Path

Vercel serves the site from the domain root. The IWSDK starter's Vite config sets `base: './'`, so built asset URLs resolve relative to the page and you do not need to change `base` for a root deployment. Vite's default `base` of `'/'` also works at the root.

If instead you serve the site from a subdirectory and your config uses an absolute `base`, set `base` to that explicit path so static assets resolve correctly:

```typescript
export default defineConfig({
  base: '/subpath/',
  // ... rest of your existing config
});
```

### Run the Deploy

From your project directory, confirm which account the Vercel CLI is signed in to:

```bash
npx vercel@latest whoami
```

Deploy to production in the current scope:

```bash
npx vercel@latest deploy --prod --yes
```

To deploy under a team instead of your current scope, list your teams and pass the team slug with `--scope`:

```bash
npx vercel@latest teams ls
npx vercel@latest deploy --prod --yes --scope <team-slug>
```

`--yes` creates the project and links it without prompting. Vercel detects Vite, runs `vite build`, and serves `dist/`. Vite copies the `public/` directory into `dist/`. Run the same command again to publish a later change.

### Use the Production URL

Use the production domain or alias that Vercel prints when the deploy finishes, such as `https://<project>.vercel.app`. Share that URL wherever your public URL is required.

If Deployment Protection is enabled for the project, some generated per-deploy URLs require authentication and return `401`. Verify that the URL you share returns `200` without authentication, as shown in [Verify the Deployment](#verify-the-deployment).

## Verify the Deployment

Confirm that the site root returns `200`:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://<DOMAIN>/
```

Open the URL in Meta Quest Browser and test the experience. Use [remote debugging](https://developers.meta.com/horizon/documentation/web/browser-remote-debugging/) to inspect the page from your development computer.

## Related Resources

- [Build & Deploy](/guides/08-build-deploy) covers production builds and GitHub Pages deployment for an IWSDK project.
- [Run Your Web Experience Offline](/guides/08b-offline) keeps a copy of the site on the device, so it loads with no connection after one online visit.
- [Submit WebXR content for the Browser new tab page](https://developers.meta.com/horizon/documentation/web/browser-new-tab/)
- [Send a web link to Meta Quest with Web Launch](https://developers.meta.com/horizon/documentation/web/web-launch/)
- [Progressive Web Apps](https://developers.meta.com/horizon/documentation/web/pwa-overview/) for optional Meta Horizon Store distribution
