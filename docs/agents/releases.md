# CI and Releases

GitHub CI checks formatting, dependencies, lint, and types. It builds one CLI tarball
and tests that file on Linux, macOS, and Windows. Download the `genesys-cli` artifact
from a CI run to try that build with `npm install /path/to/genesys-cli.tgz`.

CI runs the full eight-SDK suite on Linux for release pull requests and pushes to
`main`. The scheduled run repeats those checks against the current `main`.

## Configure GitHub and npm

1. In the repository's Actions settings, enable **Allow GitHub Actions to create
   and approve pull requests**. Changesets uses this permission to create the
   release pull request.
2. Require the **Required checks** status on `main` after GitHub records the first
   CI run. Approve CI on the Changesets pull request if GitHub requests approval.
3. In the npm settings for `@gsys/cli`, add a GitHub Actions trusted publisher.
   Use owner `Falven`, repository `genesys`, and workflow `release.yml`.
   Leave the environment field empty. Enable `npm publish`.
4. Publish a version within two days to activate a new connection.
   If the connection expires, delete it and add it again before the next release.

See the [GitHub Actions settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository)
and [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) documentation.

## Publish a version

1. Run `pnpm exec changeset` for a change to the published CLI. Commit the changeset
   with the change.
2. Wait for CI on `main`. The Release workflow creates or updates a pull request
   with the new version and release notes.
3. Review the release notes. Merge the release pull request when its checks pass.
   CI runs on the merged commit. Release then publishes that CI tarball to npm
   through Trusted Publishing. Release attaches the tarball to a GitHub release.

To start release candidates, run `pnpm exec changeset pre enter rc` and commit
the change. To return to stable releases, run `pnpm exec changeset pre exit` and
commit the change. npm serves release candidates under the `rc` tag.

If publishing fails, fix the cause and rerun the Release job while the tested
commit is current on `main`. The job checks the npm tarball before it creates
the GitHub release. If `main` advanced and npm has the version, get the tarball
from the original CI run. Check it against the npm tarball. Create the missing
GitHub release with the tested commit and the CI tarball.
