# Railway Deployment

The Customer Credit website is hosted on Railway, but the deployment workflow should now be GitHub-driven instead of manually uploading local files.

- Railway project: `fabulous-upliftment`
- Railway service: `customer-credit`
- Live site: `https://credit.nazicredit.com`
- Production deploy branch: `main`

## Normal Deployment Flow

1. Make code changes in a separate Git branch.
2. Open a pull request on GitHub.
3. Wait for GitHub checks to pass.
4. Merge the pull request into `main`.
5. Railway automatically deploys the new `main` commit.

Do not use local ZIP files, manual file replacement, or `railway up` for normal website changes.

## Emergency Only

The old local Railway deploy script may still exist for emergency recovery, but it is no longer the normal deployment path. Prefer fixing the GitHub repository and letting Railway deploy from `main`.
