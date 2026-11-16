#!/usr/bin/env bash
set -euo pipefail

tarball="${1:-${RUNNER_TEMP:?}/genesys-cli.tgz}"
manifest=packages/genesys/package.json
name="$(jq -er .name "$manifest")"
version="$(jq -er .version "$manifest")"
release="$name@$version"

if [[ -n "${CHANGESETS_OUTPUT:-}" ]]; then
  : > "$CHANGESETS_OUTPUT"
fi

if [[ "$version" == 0.0.0 ]]; then
  exit 0
fi

if gh release view "$release" --repo "$GITHUB_REPOSITORY" > /dev/null 2>&1; then
  exit 0
fi

tar -xOf "$tarball" package/package.json |
  jq -e --arg name "$name" --arg version "$version" '.name == $name and .version == $version' >/dev/null

notes="$(mktemp)"
metadata="$(mktemp)"
trap 'rm -f "$notes" "$metadata"' EXIT
tar -xOf "$tarball" package/CHANGELOG.md |
  awk -v heading="## $version" '/^## / { active=($0 == heading); next } active' > "$notes"
if ! grep -q '[^[:space:]]' "$notes"; then
  echo "Missing release notes for $release." >&2
  exit 1
fi

dist_tag=latest
release_flags=(--latest)
if [[ "$version" == *-* ]]; then
  dist_tag="$(jq -er '.tag | select(length > 0)' .changeset/pre.json)"
  release_flags=(--prerelease --latest=false)
fi

registry_url="https://registry.npmjs.org/${name/\//%2f}/$version"
integrity="sha512-$(openssl dgst -sha512 -binary "$tarball" | openssl base64 -A)"
status="$(curl -sSL --retry 3 --output "$metadata" --write-out '%{http_code}' "$registry_url")"
if [[ "$status" == 404 ]]; then
  npm publish "$tarball" --access public --tag "$dist_tag"
  for attempt in {1..24}; do
    status="$(curl -sSL --retry 3 --output "$metadata" --write-out '%{http_code}' "$registry_url")"
    if [[ "$status" != 404 ]]; then
      break
    fi
    sleep 5
  done
fi
if [[ "$status" != 200 ]]; then
  echo "npm returned HTTP $status for $release." >&2
  exit 1
fi
if [[ "$(jq -er .dist.integrity "$metadata")" != "$integrity" ]]; then
  echo "npm serves a different tarball for $release." >&2
  exit 1
fi

gh release create "$release" "$tarball" --repo "$GITHUB_REPOSITORY" \
  --target "$(git rev-parse HEAD)" --title "$release" --notes-file "$notes" "${release_flags[@]}"

if [[ -n "${CHANGESETS_OUTPUT:-}" ]]; then
  jq -cn --arg name "$name" --arg tag "$release" '{type:"git-tag", packageName:$name, tag:$tag}' \
    >> "$CHANGESETS_OUTPUT"
fi
