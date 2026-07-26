# Release Protocol

Read this reference only for Stage 5. The current `docs/release.md`, `project-index.md`, Release
evidence, branch state, tag, and workflow are the live authority.

## Entry Conditions

Require all of the following before a publication mutation:

1. Exact Paseo base and target SHAs are recorded.
2. Every upstream commit is classified or explicitly ignored.
3. The accepted source is integrated on one final Thoth path.
4. Current required local gates and product journeys pass.
5. Documentation, provenance, TODO, acceptance, failures, and run-log state are synchronized.
6. The exact Thoth source SHA and intended public artifact set are frozen.
7. The user explicitly authorizes the concrete push, merge, tag, Release, deployment, store, or
   publication operation about to occur.

## Mutation Rules

- Use only the authorized branches and Release target.
- Use the repository `npm run gh -- ...` entry for GitHub operations.
- Do not use global GitHub authentication, expose credentials, or place pairing tokens in URLs,
  logs, documentation examples, Telemetry, or reports.
- Do not force push, merge, retag, publish, deploy, or mutate another service unless the current
  authorization explicitly permits that exact operation.
- Perform a fresh remote drift guard immediately before mutation.
- Require an exact-SHA workflow. If any mandatory job fails, stop publication and preserve the old
  Release intact.
- Never replace missing workflow evidence with manually assembled assets.

## Public Reverification

After the publish job succeeds:

1. Verify the remote branch, tag, Release metadata, and workflow source SHA.
2. Verify the exact expected asset set; unexpected or missing assets fail the closeout.
3. Download the public artifacts again.
4. Verify checksums, sizes, build identity, update manifests, and source metadata.
5. Run the required installed or packaged product journey against the downloaded artifact.
6. Report `published` only after every check passes.

The following are not publication proof by themselves: a local build, a green unit suite, a tag, a
workflow start, a Release page, an uploaded asset, or an unverified checksum file.
