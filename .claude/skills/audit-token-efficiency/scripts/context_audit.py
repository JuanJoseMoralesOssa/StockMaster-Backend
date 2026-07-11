#!/usr/bin/env python3
"""Measure repository instruction context without requiring tokenizer packages."""

from __future__ import annotations

import argparse
import json
import math
import re
from collections import defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path

FRONTMATTER_PATTERN = re.compile(r"\A---\s*\n(.*?)\n---\s*\n", re.DOTALL)
DESCRIPTION_PATTERN = re.compile(r"^description:\s*(.+)$", re.MULTILINE)
MARKDOWN_PATH_PATTERN = re.compile(r"(?:@|`)([^`\s]+\.md)`?")
EXCLUDED_DIRECTORY_NAMES = {".git", ".mypy_cache", ".pytest_cache", ".ruff_cache", ".venv", "node_modules"}


@dataclass(frozen=True)
class FileMetric:
    path: str
    lines: int
    characters: int
    estimated_tokens: int


def _metric(path: Path, root: Path) -> FileMetric:
    content = path.read_text(encoding="utf-8")
    return FileMetric(
        path=path.relative_to(root).as_posix(),
        lines=len(content.splitlines()),
        characters=len(content),
        estimated_tokens=math.ceil(len(content) / 4),
    )


def _skill_metadata(path: Path, root: Path) -> dict[str, object]:
    content = path.read_text(encoding="utf-8")
    frontmatter_match = FRONTMATTER_PATTERN.search(content)
    frontmatter = frontmatter_match.group(1) if frontmatter_match else ""
    description_match = DESCRIPTION_PATTERN.search(frontmatter)
    description = description_match.group(1).strip(" '\"") if description_match else ""
    metric = _metric(path, root)
    return {
        **asdict(metric),
        "description_characters": len(description),
        "description_estimated_tokens": math.ceil(len(description) / 4),
    }


def _meaningful_lines(path: Path) -> set[str]:
    lines: set[str] = set()
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        normalized = re.sub(r"\s+", " ", raw_line.strip().lower())
        if len(normalized) >= 45 and not normalized.startswith(("#", "```", "<!--")):
            lines.add(normalized)
    return lines


def _duplicate_lines(paths: list[Path], root: Path) -> list[dict[str, object]]:
    occurrences: dict[str, list[str]] = defaultdict(list)
    for path in paths:
        for line in _meaningful_lines(path):
            occurrences[line].append(path.relative_to(root).as_posix())
    return [{"text": line, "files": files} for line, files in sorted(occurrences.items()) if len(files) > 1]


def _missing_references(paths: list[Path], root: Path) -> list[dict[str, str]]:
    missing: list[dict[str, str]] = []
    for source in paths:
        content = source.read_text(encoding="utf-8")
        for reference in MARKDOWN_PATH_PATTERN.findall(content):
            target = (source.parent / reference).resolve()
            if not target.exists():
                missing.append({"source": source.relative_to(root).as_posix(), "reference": reference})
    return missing


def audit(root: Path) -> dict[str, object]:
    root = root.resolve()
    instruction_paths = sorted(
        path
        for path in root.rglob("AGENTS.md")
        if not EXCLUDED_DIRECTORY_NAMES.intersection(path.relative_to(root).parts)
    )
    claude_path = root / "CLAUDE.md"
    if claude_path.exists():
        instruction_paths.append(claude_path)
    instruction_paths = sorted(set(instruction_paths))
    skill_paths = sorted((root / ".claude" / "skills").glob("*/SKILL.md"))

    instruction_metrics = [_metric(path, root) for path in instruction_paths]
    skill_metrics = [_skill_metadata(path, root) for path in skill_paths]
    warnings: list[str] = []

    root_agents = root / "AGENTS.md"
    if root_agents.exists() and _metric(root_agents, root).lines > 150:
        warnings.append("AGENTS.md supera 150 líneas; revisar si contiene contexto no universal.")
    if claude_path.exists() and "@AGENTS.md" not in claude_path.read_text(encoding="utf-8"):
        warnings.append("CLAUDE.md no importa @AGENTS.md; revisar duplicación entre agentes.")
    for skill in skill_metrics:
        if int(skill["lines"]) > 500:
            warnings.append(f"{skill['path']} supera 500 líneas; aplicar divulgación progresiva.")
        if int(skill["description_characters"]) > 600:
            warnings.append(f"{skill['path']} tiene una descripción costosa (>600 caracteres).")

    duplicates = _duplicate_lines(instruction_paths + skill_paths, root)
    missing_references = _missing_references(instruction_paths, root)
    if duplicates:
        warnings.append(f"Hay {len(duplicates)} líneas extensas duplicadas entre archivos de contexto.")
    if missing_references:
        warnings.append(f"Hay {len(missing_references)} referencias Markdown inexistentes.")

    return {
        "estimation": "ceil(characters / 4); indicador relativo, no tokenización del proveedor",
        "instructions": [asdict(metric) for metric in instruction_metrics],
        "skills": skill_metrics,
        "duplicate_lines": duplicates,
        "missing_references": missing_references,
        "warnings": warnings,
    }


def _print_human(report: dict[str, object]) -> None:
    print(f"Estimación: {report['estimation']}")
    for section in ("instructions", "skills"):
        print(f"\n{section.upper()}")
        for item in report[section]:
            print(f"- {item['path']}: {item['lines']} líneas, ~{item['estimated_tokens']} tokens")
    warnings = report["warnings"]
    print("\nADVERTENCIAS")
    if not warnings:
        print("- Ninguna señal mecánica encontrada.")
    for warning in warnings:
        print(f"- {warning}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", nargs="?", type=Path, default=Path.cwd())
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args()
    report = audit(args.root)
    if args.as_json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        _print_human(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
