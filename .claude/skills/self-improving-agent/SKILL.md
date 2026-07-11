---
name: self-improving-agent
description: "Maintains .learnings/ with ERRORS.md, LEARNINGS.md, and lessons.jsonl. Promotes recurring lessons to CLAUDE.md after N occurrences."
---

# Self-Improving Agent

## When to add an entry

Concrete triggers:

1. **Unexpected command error**: the `PostToolUse` hook captures it automatically.
2. **User correction**: "do not do that", "stop", or "that is not how this works here". Create a `correction` entry in `LEARNINGS.md`.
3. **Missing capability**: you needed a tool that does not exist in this project. Create a `knowledge_gap` entry in `FEATURE_REQUESTS.md`.
4. **Better approach discovered**: create a `best_practice` or `insight` entry in `LEARNINGS.md`.

## Entry format

```markdown
## ${TIMESTAMP} - ${TYPE}
- **Context**: <task or command that triggered the lesson>
- **Lesson**: <one-line rule>
- **Why**: <reason, ideally with incident reference>
- **How to apply**: <when and where it triggers>
- **Status**: NEW
```

Also write a JSONL entry to `lessons.jsonl` conforming to `lesson.schema.json`.

## Promotion pipeline

1. Entry starts as `NEW`.
2. `/si-review` reviews `NEW` entries with 2 or more occurrences and proposes promotion.
3. The user approves with `/si-promote <hash>`.
4. The rule is appended to `CLAUDE.md` and the entry is marked `PROMOTED`.
5. Entries that stay `NEW` for 30 days without promotion are marked `OBSOLETE`.

## How it is read

- Planner and dev agents read `.learnings/ERRORS.md` and `.learnings/LEARNINGS.md` before reasoning about the task.
- Reviewers also read them to avoid flagging known issues as new high-severity findings.
