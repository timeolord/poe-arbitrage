#!/usr/bin/env fish

set project_dir (path dirname (path dirname (status filename)))
cd $project_dir; or exit 1
gh auth status; or exit 1
if not test -d .git
    git init -b main; or exit 1
end
git add Cargo.toml Cargo.lock flake.nix .envrc .gitignore src scripts tests web .github README.md; or exit 1
if not git diff --cached --quiet
    git commit -m 'add historical currency arbitrage scanner and dashboard'; or exit 1
end
gh repo create poe-arbitrage --public --description 'Historical Path of Exile currency arbitrage scanner' --source . --remote origin --push; or exit 1
set repo (gh repo view --json nameWithOwner --jq .nameWithOwner); or exit 1
gh api --method POST repos/$repo/pages -f build_type=workflow; or exit 1
gh workflow run pages.yml; or exit 1
printf 'created https://github.com/%s\n' $repo
