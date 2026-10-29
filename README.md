# Signal Watch

Signal Watch is a lightweight, browser-based internet download speed monitor. It runs a speed check immediately when monitoring starts, repeats the check at a configurable interval, and keeps session statistics until you select **End test**.

## Features

- Download-speed checks from the device running the browser
- Two-minute default interval with custom seconds or minutes
- Completed-test count plus current, lowest, average, and highest speeds
- Offline-event counter
- Recent-check history
- Saved sessions with options to continue or start fresh
- Light and dark themes
- Responsive layout
- No account, database, or build step required

## How the measurement works

The JavaScript runs in the visitor's browser and downloads a temporary 10 MB test payload from Cloudflare's speed-test endpoint. This means a Vercel-hosted copy measures the visitor's network path, not Vercel's server connection.

Results are saved only in the current browser's local storage so a session can continue after a refresh or browser restart. They are never uploaded by this app. Use **Start fresh** to permanently clear the saved session. Each completed check uses approximately 10 MB of data, so short intervals can consume significant bandwidth.

Browser scheduling may slow or pause checks when the tab is in the background, the device sleeps, or the operating system enables power saving.

## Run locally

You can open `index.html` directly, but a small local web server provides more consistent browser behavior.

Using Python:

```bash
python -m http.server 8080
```

Then visit <http://localhost:8080>.

Using Node.js:

```bash
npx serve .
```

## Deploy to Vercel

### Vercel dashboard

1. Push this repository to GitHub, GitLab, or Bitbucket.
2. Import the repository in Vercel.
3. Select **Other** as the framework preset if Vercel does not detect a preset.
4. Leave the build command and output directory empty.
5. Deploy.

No environment variables are required.

### Vercel CLI

From the project directory:

```bash
npx vercel
```

For a production deployment:

```bash
npx vercel --prod
```

## Project structure

```text
.
|-- index.html       # Page structure
|-- styles.css       # Responsive design and themes
|-- app.js           # Monitoring and speed-test logic
`-- dist/            # Static deployment copy
```

The root files are sufficient for local use and Vercel. The `dist` directory is a packaged copy from the earlier hosting workflow; it can be kept for static-host compatibility or removed if you only deploy the root files.

## Configuration

The main test settings are at the top of `app.js`:

```js
const TEST_URL = "https://speed.cloudflare.com/__down";
const TEST_BYTES = 10_000_000;
const TEST_TIMEOUT_MS = 30_000;
```

Changing `TEST_BYTES` changes the approximate data used by each check. Smaller downloads use less data but can produce less stable results on fast connections.

## Privacy

Signal Watch has no analytics, cookies, account system, or result-storage backend. The selected theme and speed-test session are saved in `localStorage` on the current device. **Start fresh** clears the saved test session.
