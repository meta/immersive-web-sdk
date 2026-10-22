---
outline: [2, 4]
---

# Chapter 8: Build & Deploy

You've built an amazing WebXR experience! Now it's time to optimize and deploy it so others can experience your creation. This chapter shows you how to build for production and deploy to GitHub Pages.

## Production Build Process

Your starter app uses Vite to create a production build. When you run `npm run build`, it:

- Bundles and minifies your JavaScript/TypeScript code
- Generates a deployable static site in the `dist/` folder

## Building Your Project

Navigate to your project directory and run:

```bash
npm run build
```

This creates a `dist/` folder with your application. The build automatically:

- Bundles and minifies JavaScript
- Copies public assets
- Excludes Havok when `world.features.physics` is `false`
- Retains only bundled fonts referenced by static UIKitML under `public/`

### Inspecting the Production Bundle

Vite prints each emitted file and its compressed size. For a repeatable local
inventory, build and sort the asset files by size:

```bash
npm run build
find dist/assets -maxdepth 1 -type f -exec du -h {} + | sort -h
```

Set `world.features.physics` in `iwsdk.config.json` to match the application;
`false` removes the Havok JavaScript and WASM payload. IWSDK also scans static
UIKitML and removes unreferenced packaged font modules. Custom `@font-face`
TTFs remain ordinary public assets and are not treated as bundled families.

If the application loads UIKitML from a remote endpoint or constructs the
bundled family name dynamically, retain those families explicitly in
`vite.config.ts` because build-time scanning cannot see that content:

```typescript
iwsdkDev({
  bundle: { fonts: ['roboto', 'inter'] },
});
```

Use `fonts: 'all'` only when font selection is fully dynamic. A production
attempt to load an excluded family fails with a message naming this escape
hatch instead of silently downloading every packaged atlas.

Lucide icons follow the same rule. The default UIKitML kit can name any of
about 1,600 Lucide icon components, but a production build keeps only the icons
used in static UIKitML, plus the few that Horizon components use internally.
List the icons that only remote or generated UIKitML uses:

```typescript
iwsdkDev({
  bundle: { icons: ['Settings', 'CircleHelp'] },
});
```

Use `icons: 'all'` only when icon selection is fully dynamic; it adds several
megabytes to the bundle. If UIKitML in a production build names an icon that
was left out, parsing fails with an error that points to this option.

## Asset Optimization

Vite copies files from `public/` without rewriting them. Optimize large models and
textures in your asset-production pipeline before adding them to the project, then
verify their visual quality and download size in a production build.

## Deploying to GitHub Pages

This section covers GitHub Pages. For additional hosting options, see [Host Your Web Experience](/guides/08a-web-hosting).

GitHub Pages provides free hosting perfect for WebXR applications.

### Step 1: Configure Base Path

Update your `vite.config.ts` to set the correct base path:

```typescript
export default defineConfig({
  base: '/your-repository-name/', // Must match your GitHub repo name
  // ... rest of your existing config
});
```

### Step 2: Manual Deployment

Install the gh-pages tool and deploy:

```bash
# Install deployment tool
npm install -D gh-pages

# Build and deploy
npm run build
npx gh-pages -d dist
```

### Step 3: Enable GitHub Pages

1. Go to your repository on GitHub
2. **Settings** → **Pages**
3. Source: "Deploy from a branch"
4. Select `gh-pages` branch
5. **Save**

Your app will be live at: `https://yourusername.github.io/your-repository-name/`

### Automated Deployment with GitHub Actions

For automatic deployment on every push, create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: ['main']

  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm install

      - name: Build
        run: npm run build

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: './dist'

      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

## What's Next?

Congratulations! You've completed the IWSDK getting-started tutorial and successfully built and deployed your first WebXR application. You've now experienced the complete end-to-end workflow of IWSDK development - from creating basic 3D scenes to implementing custom systems and deploying optimized applications.

Throughout this tutorial, you've learned how to:

- Set up IWSDK projects and load external assets
- Create professional environments with lighting and backgrounds
- Build interactive experiences with grabbing and locomotion
- Develop custom systems and components using ECS architecture
- Build and deploy IWSDK applications

You now have the foundation to create professional WebXR experiences with IWSDK!
