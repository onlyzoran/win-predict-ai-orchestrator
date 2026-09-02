#!/usr/bin/env bash
# Add a new Goal issue to ai-engineering-autopilot in Inbox.
set -euo pipefail

ISSUE_URL="${1:?issue url}"
ISSUE_NUMBER="${2:?issue number}"
REPO_OWNER="${3:?owner}"
REPO_NAME="${4:?repo}"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REGISTRY="${ROOT}/orchestrator/products/registry.json"
PROJECT_ID="$(jq -r '."win-predict-ai".board.id' "$REGISTRY")"
STATUS_FIELD="$(jq -r '."win-predict-ai".board.statusFieldId' "$REGISTRY")"
INBOX_OPTION="$(jq -r '."win-predict-ai".board.statusOptions.Inbox' "$REGISTRY")"

labels_csv="${LABELS:-}"
case ",${labels_csv}," in
  *,win-predict-ai,* | *,telegram-bots,* | *,ios-games,* | *,shoppable-feed,* | *,gift-sales,*)
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
                id
              }
            }
          }
        }
      }
    }
  ' -f owner="$REPO_OWNER" -f repo="$REPO_NAME" -F number="$ISSUE_NUMBER" \
    --jq "[.data.repository.issue.projectItems.nodes[] | select(.project.id == \"$PROJECT_ID\")] | length"
)"

if [[ "$already" != "0" ]]; then
  echo "already on project ${PROJECT_ID}"
  exit 0
fi

content_id="$(
  gh api graphql -f query='
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $number) {
          id
        }
      }
    }
  ' -f owner="$REPO_OWNER" -f repo="$REPO_NAME" -F number="$ISSUE_NUMBER" \
    --jq '.data.repository.issue.id'
)"

item_id="$(
  gh api graphql -f query='
    mutation($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
        item {
          id
        }
      }
    }
  ' -f projectId="$PROJECT_ID" -f contentId="$content_id" \
    --jq '.data.addProjectV2ItemById.item.id'
)"

gh api graphql -f query='
  mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
    updateProjectV2ItemFieldValue(
      input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
        value: { singleSelectOptionId: $optionId }
      }
    ) {
      projectV2Item {
        id
      }
    }
  }
' -f projectId="$PROJECT_ID" -f itemId="$item_id" -f fieldId="$STATUS_FIELD" -f optionId="$INBOX_OPTION" >/dev/null

echo "added ${ISSUE_URL} → Inbox (${PROJECT_ID})"
