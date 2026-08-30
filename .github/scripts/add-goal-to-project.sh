#!/usr/bin/env bash
# Add a new Goal issue to ai-engineering-autopilot (project #3) in Inbox.
set -euo pipefail

ISSUE_URL="${1:?issue url}"
ISSUE_NUMBER="${2:?issue number}"
REPO_OWNER="${3:?owner}"
REPO_NAME="${4:?repo}"
PROJECT_OWNER="${5:-onlyzoran}"
PROJECT_NUMBER="${6:-3}"

labels_csv="${LABELS:-}"
case ",${labels_csv}," in
  *,win-predict-ai,* | *,telegram-bots,* | *,ios-games,*)
    ;;
  *)
    echo "skip: no product label (${labels_csv})"
    exit 0
    ;;
esac

already="$(
  gh api graphql -f query='
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $number) {
          projectItems(first: 20) {
            nodes {
              project {
                number
              }
            }
          }
        }
      }
    }
  ' -f owner="$REPO_OWNER" -f repo="$REPO_NAME" -F number="$ISSUE_NUMBER" \
    --jq "[.data.repository.issue.projectItems.nodes[] | select(.project.number == ${PROJECT_NUMBER})] | length"
)"

if [[ "$already" != "0" ]]; then
  echo "already on project #${PROJECT_NUMBER}"
  exit 0
fi

gh project item-add "$PROJECT_NUMBER" --owner "$PROJECT_OWNER" --url "$ISSUE_URL"
gh project item-edit "$PROJECT_NUMBER" --owner "$PROJECT_OWNER" --url "$ISSUE_URL" --field Status --value Inbox
echo "added ${ISSUE_URL} → Inbox"
