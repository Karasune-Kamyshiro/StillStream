#!/usr/bin/env bash
# Builds the StillStream Flatpak repository that GitHub Pages serves, from release bundles.
#
#   stable  the latest full release
#   beta    the newest release of all, pre-releases included
#
# The repository is rebuilt from scratch on every release, one commit per branch, so it never
# grows. Commits keep their bundle's timestamp, so re-publishing an unchanged branch produces the
# identical commit and installed copies see no phantom update.
#
# Environment:
#   BETA_BUNDLE       .flatpak bundle for the beta branch (required)
#   STABLE_BUNDLE     .flatpak bundle for the stable branch (optional: no stable release yet)
#   SITE_DIR          output directory, published as the site root (required, must not exist)
#   SITE_URL          public URL of the site root, e.g. https://owner.github.io/StillStream
#   GPG_PRIVATE_KEY   ASCII-armoured private key that signs commits and the summary (required)
set -Eeuo pipefail

APP_ID="io.github.karasune.StillStream"
ARCH="x86_64"
RUNTIME_REPO="https://dl.flathub.org/repo/flathub.flatpakrepo"
HOMEPAGE="https://github.com/Karasune-Kamyshiro/StillStream"

if [[ "${1:-}" == "--help" ]]; then
  sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 0
fi

for name in BETA_BUNDLE SITE_DIR SITE_URL GPG_PRIVATE_KEY; do
  if [[ -z "${!name:-}" ]]; then
    printf 'Missing required environment variable: %s\n' "${name}" >&2
    exit 2
  fi
done
for command_name in flatpak gpg base64; do
  command -v "${command_name}" >/dev/null || {
    printf 'Missing required command: %s\n' "${command_name}" >&2
    exit 1
  }
done
if [[ -e "${SITE_DIR}" ]]; then
  printf 'SITE_DIR already exists: %s\n' "${SITE_DIR}" >&2
  exit 1
fi

WORK_DIR="$(mktemp -d)"
trap 'rm -rf -- "${WORK_DIR}"' EXIT
export GNUPGHOME="${WORK_DIR}/gnupg"
mkdir -m 700 -- "${GNUPGHOME}"
printf '%s\n' "${GPG_PRIVATE_KEY}" | gpg --batch --quiet --import
KEY_ID="$(gpg --batch --with-colons --list-secret-keys | awk -F: '$1 == "fpr" { print $10; exit }')"
if [[ -z "${KEY_ID}" ]]; then
  printf 'GPG_PRIVATE_KEY holds no usable secret key\n' >&2
  exit 1
fi
PUBLIC_KEY="$(gpg --batch --export "${KEY_ID}" | base64 -w0)"
SIGN=(--gpg-sign="${KEY_ID}" --gpg-homedir="${GNUPGHOME}")

SITE_URL="${SITE_URL%/}"
REPO_DIR="${SITE_DIR}/repo"
mkdir -p -- "${SITE_DIR}"
SITE_DIR="$(cd -- "${SITE_DIR}" && pwd -P)"
REPO_DIR="${SITE_DIR}/repo"

# What `ostree init --mode=archive-z2` creates; the ostree CLI is not always installed next to
# flatpak, and flatpak only creates repositories while exporting a build directory.
init_repo() {
  mkdir -p -- "$1"/{objects,tmp/cache,state,extensions,refs/heads,refs/mirrors,refs/remotes}
  printf '[core]\nrepo_version=1\nmode=archive-z2\n' > "$1/config"
  # flatpak reads repository metadata from the summary, so an empty one must exist first.
  flatpak build-update-repo "$1" >/dev/null
}

publish_branch() {
  local branch="$1" bundle="$2"
  local import="${WORK_DIR}/import-${branch}"
  init_repo "${import}"
  # Expected GLib-CRITICAL noise from this command on some flatpak versions is harmless.
  flatpak build-import-bundle --no-update-summary "${import}" "${bundle}" >/dev/null 2>&1
  local source_ref=""
  local head
  for head in "${import}/refs/heads/app/${APP_ID}/${ARCH}"/*; do
    [[ -f "${head}" ]] && source_ref="${head#"${import}/refs/heads/"}" && break
  done
  if [[ -z "${source_ref}" ]]; then
    printf '%s does not contain %s\n' "${bundle}" "${APP_ID}" >&2
    exit 1
  fi
  flatpak build-commit-from --no-update-summary "${SIGN[@]}" \
    --src-repo="${import}" --src-ref="${source_ref}" \
    "${REPO_DIR}" "app/${APP_ID}/${ARCH}/${branch}"
  printf 'Published %s as app/%s/%s/%s\n' "$(basename -- "${bundle}")" "${APP_ID}" "${ARCH}" "${branch}"
}

init_repo "${REPO_DIR}"
publish_branch beta "${BETA_BUNDLE}"
if [[ -n "${STABLE_BUNDLE:-}" ]]; then
  publish_branch stable "${STABLE_BUNDLE}"
fi

flatpak build-update-repo "${SIGN[@]}" \
  --title="StillStream" \
  --comment="StillStream releases (stable) and pre-releases (beta)" \
  --homepage="${HOMEPAGE}" \
  --default-branch=stable \
  --gpg-import=<(gpg --batch --export "${KEY_ID}") \
  "${REPO_DIR}" >/dev/null

cat > "${SITE_DIR}/stillstream.flatpakrepo" <<EOF
[Flatpak Repo]
Title=StillStream
Url=${SITE_URL}/repo/
Homepage=${HOMEPAGE}
Comment=StillStream releases (stable) and pre-releases (beta)
DefaultBranch=stable
GPGKey=${PUBLIC_KEY}
EOF

write_ref() {
  local branch="$1" file="$2"
  cat > "${SITE_DIR}/${file}" <<EOF
[Flatpak Ref]
Name=${APP_ID}
Branch=${branch}
Title=StillStream (${branch})
Url=${SITE_URL}/repo/
Homepage=${HOMEPAGE}
IsRuntime=false
SuggestRemoteName=stillstream
RuntimeRepo=${RUNTIME_REPO}
GPGKey=${PUBLIC_KEY}
EOF
}
write_ref stable "${APP_ID}.flatpakref"
write_ref beta "${APP_ID}-beta.flatpakref"

cat > "${SITE_DIR}/index.html" <<EOF
<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>StillStream Flatpak repository</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;background:#0e0e10;color:#efeff1}code,pre{background:#1f1f23;border-radius:6px}pre{padding:1rem;overflow-x:auto}a{color:#bf94ff}</style>
<h1>StillStream Flatpak repository</h1>
<p>Install once from here; afterwards updates arrive like for any other Flatpak app (Discover, GNOME Software or <code>flatpak update</code>).</p>
<h2>Releases (stable)</h2>
<pre>flatpak install --user ${SITE_URL}/${APP_ID}.flatpakref</pre>
<h2>Pre-releases (beta)</h2>
<pre>flatpak install --user ${SITE_URL}/${APP_ID}-beta.flatpakref</pre>
<p>Settings, favourites and sign-in are shared between both branches. <a href="${HOMEPAGE}">Source and release notes</a>.</p>
</html>
EOF
touch "${SITE_DIR}/.nojekyll"
printf 'Flatpak repository ready in %s (signed by %s)\n' "${SITE_DIR}" "${KEY_ID}"
