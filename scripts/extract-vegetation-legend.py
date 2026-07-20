#!/usr/bin/env python3
"""Extract the hierarchical vegetation legend used by the geoportal.

Usage:
  python scripts/extract-vegetation-legend.py \
    Leyenda_Vegetacion.pdf public/data/vegetation-timeseries.json \
    public/data/vegetation-descriptions.json
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pdfplumber


REGIONS = {
    "a": {"name": "Amazonía", "pages": range(7, 14)},
    "b": {"name": "Beni", "pages": range(14, 23)},
    "c": {"name": "Chiquitanía", "pages": range(23, 25)},
}


@dataclass
class Line:
    page: int
    top: float
    words: list[dict[str, Any]]

    @property
    def x(self) -> float:
        return float(self.words[0]["x0"])

    @property
    def size(self) -> float:
        return max(float(word["size"]) for word in self.words)

    @property
    def text(self) -> str:
        return " ".join(str(word["text"]) for word in self.words)


@dataclass
class Node:
    code: str
    parent: str | None
    level: int
    region: str
    lines: list[Line] = field(default_factory=list)
    children: list[str] = field(default_factory=list)


def normalize_marker(value: str) -> str:
    value = value.lower().strip().replace("’", "'").replace("q", "q")
    value = value.rstrip(".:-")
    return value.replace(" ", "")


def is_bold(word: dict[str, Any]) -> bool:
    return "bold" in str(word.get("fontname", "")).lower()


def is_italic(word: dict[str, Any]) -> bool:
    return "italic" in str(word.get("fontname", "")).lower()


def extract_lines(pdf: pdfplumber.PDF, pages: range) -> list[Line]:
    lines: list[Line] = []
    for page_index in pages:
        page = pdf.pages[page_index]
        words = page.extract_words(extra_attrs=["fontname", "size"])
        grouped: list[list[dict[str, Any]]] = []
        for word in words:
            top = float(word["top"])
            if top < 70 or top > 718:
                continue
            group = next((item for item in reversed(grouped[-4:]) if abs(float(item[0]["top"]) - top) < 1.0), None)
            if group is None:
                group = []
                grouped.append(group)
            group.append(word)
        for group in grouped:
            group.sort(key=lambda item: float(item["x0"]))
            text = " ".join(str(item["text"]) for item in group)
            if re.fullmatch(r"\d+", text.strip()):
                continue
            if "www.rumbol" in text.lower() or text.strip().startswith("Rumbol"):
                continue
            lines.append(Line(page_index + 1, float(group[0]["top"]), group))
    return lines


def parse_amazon_marker(line: Line, state: dict[str, Any]) -> tuple[str, str | None, int] | None:
    text = line.text.strip()
    if text.startswith("I. LEYENDA") or text.startswith("SUPER-SISTEMAS") or text.startswith("**"):
        return None

    group = re.match(r"^(\d+)\.(?:\s|$)", text)
    if group and line.x < 130:
        code = f"a{group.group(1)}"
        state.update(group=code, level1=None, level2=None)
        return code, None, 0

    compound = re.match(r"^(iii)\s*([a-z])\.\s", text, re.IGNORECASE)
    if compound and state.get("level1"):
        parent = f"{state['level1']}iii"
        code = f"{parent}{compound.group(2).lower()}"
        state["level2"] = parent
        return code, parent, 3

    raw_marker = str(line.words[0]["text"])
    marker = normalize_marker(raw_marker)
    if re.fullmatch(r"[a-z]'?", marker) and 135 <= line.x < 165 and state.get("group"):
        if not re.search(r"[.\-’']$", raw_marker):
            return None
        code = f"{state['group']}{marker}"
        state.update(level1=code, level2=None)
        return code, state["group"], 1

    roman = marker.replace("g", "i")
    if roman in {"i", "ii", "iii", "iv", "v"} and line.x >= 165 and state.get("level1"):
        code = f"{state['level1']}{roman}"
        state["level2"] = code
        return code, state["level1"], 2
    if marker in {"dd", "de"} and line.x >= 180 and state.get("level1"):
        code = f"{state['group']}{marker}"
        return code, state["level1"], 2
    if re.fullmatch(r"[a-z]", marker) and line.x >= 185 and state.get("level1") and raw_marker.endswith("."):
        code = f"{state['level1']}{marker}"
        return code, state["level1"], 2
    return None


def parse_beni_marker(line: Line, state: dict[str, Any]) -> tuple[str, str | None, int] | None:
    text = line.text.strip()
    if text.startswith(("II. LEYENDA", "I. SISTEMAS", "II. SUPERSISTEMAS", "a)-", "b)-", "Co0")):
        return None

    group = re.match(r"^Grupo\s+(\d+)\.\s", text, re.IGNORECASE)
    if group:
        code = f"b{group.group(1)}"
        state.update(group=code, subgroup=None, level1=None, level2=None)
        return code, None, 0

    full = re.match(r"^(\d+\.\d+)\.([a-z])\.([a-z])\.\s", text, re.IGNORECASE)
    if full:
        parent = f"b{full.group(1)}{full.group(2).lower()}"
        code = f"{parent}{full.group(3).lower()}"
        return code, parent, 3

    subgroup = re.match(r"^(\d+\.\d+(?:\.\d+)?)(?:\.\s|\s)", text)
    if subgroup and line.x < 115:
        code = f"b{subgroup.group(1)}"
        parts = subgroup.group(1).split(".")
        parent = f"b{'.'.join(parts[:-1])}" if len(parts) > 2 else f"b{parts[0]}"
        state.update(group=f"b{parts[0]}", subgroup=code, level1=None, level2=None)
        return code, parent, len(parts) - 1

    direct = re.match(r"^(\d+)\.\s", text)
    if direct and line.x < 110 and (line.size >= 11 or int(direct.group(1)) >= 13):
        code = f"b{direct.group(1)}"
        state.update(group=code, subgroup=None, level1=None, level2=None)
        return code, None, 0

    if text.lower().startswith("ad :") and state.get("level1") == "b10a":
        return "b10ad", "b10a", 2

    if line.x >= 130 and state.get("level1"):
        prime = re.match(r"^\[?([a-z])['’]\.\s", text, re.IGNORECASE)
        if prime:
            code = f"{state['level1']}'"
            return code, state["level1"], 3

    raw_marker = str(line.words[0]["text"])
    marker = normalize_marker(raw_marker)
    spaced_marker = re.match(r"^([a-z])\s*(\d+)\.\s", text, re.IGNORECASE)
    dashed_marker = re.match(r"^([a-z])\s*-\s", text, re.IGNORECASE)
    if spaced_marker:
        marker = f"{spaced_marker.group(1).lower()}{spaced_marker.group(2)}"
    elif dashed_marker:
        marker = dashed_marker.group(1).lower()
    numeric_marker = re.fullmatch(r"(\d+)", marker)
    if numeric_marker and line.x >= 145 and state.get("level1") and raw_marker.endswith("."):
        parent = state["level1"]
        code = f"{parent}{numeric_marker.group(1)}"
        state["level2"] = code
        return code, parent, 2
    if not re.fullmatch(r"[a-z](?:\d+)?'?", marker):
        return None
    if not re.search(r"[.\-’']$", raw_marker) and not spaced_marker and not dashed_marker:
        return None

    if line.x >= 145 and state.get("level1") and line.x > float(state.get("level1_x", 999)) + 2:
        parent = state["level1"]
        code = f"{parent}{marker}"
        state["level2"] = code
        return code, parent, 2

    parent = state.get("subgroup") or state.get("group")
    if not parent:
        return None
    code = f"{parent}{marker}"
    state.update(level1=code, level1_x=line.x, level2=None)
    return code, parent, 2 if state.get("subgroup") else 1


def parse_chiquitania_marker(line: Line, state: dict[str, Any]) -> tuple[str, str | None, int] | None:
    text = line.text.strip()
    if text.startswith("III. LEYENDA"):
        return None
    group = re.match(r"^(\d+)\.\s", text)
    if group and line.size >= 10:
        code = f"c{group.group(1)}"
        state.update(group=code, level1=None)
        return code, None, 0
    raw_marker = str(line.words[0]["text"])
    marker = normalize_marker(raw_marker)
    if re.fullmatch(r"[a-z]{1,2}", marker) and state.get("group"):
        if not re.search(r"[.\-’']$", raw_marker):
            return None
        code = f"{state['group']}{marker}"
        state["level1"] = code
        return code, state["group"], 1
    return None


def word_runs(words: list[dict[str, Any]]) -> list[dict[str, Any]]:
    runs: list[dict[str, Any]] = []
    for index, word in enumerate(words):
        text = str(word["text"])
        if index:
            previous = words[index - 1]
            gap = float(word["x0"]) - float(previous["x1"])
            if gap > 0.8 and text not in {".", ",", ";", ":", ")", "]"}:
                text = " " + text
        style = {"bold": is_bold(word), "italic": is_italic(word)}
        if runs and runs[-1]["bold"] == style["bold"] and runs[-1]["italic"] == style["italic"]:
            runs[-1]["text"] += text
        else:
            runs.append({"text": text, **style})
    for run in runs:
        run["text"] = run["text"].replace("V egetación", "Vegetación")
        run["text"] = re.sub(r"CES(\d+)\.\s+(\d+)", r"CES\1.\2", run["text"])
    return runs


def merge_lines(lines: list[Line]) -> list[dict[str, Any]]:
    all_words: list[dict[str, Any]] = []
    previous_line: Line | None = None
    for line in lines:
        if previous_line is not None and all_words:
            last = all_words[-1]
            first = line.words[0]
            if str(last["text"]).endswith("-") and not is_italic(last):
                last["text"] = str(last["text"])[:-1]
                first = dict(first)
                first["x0"] = last["x1"]
                line_words = [first, *line.words[1:]]
            else:
                first = dict(first)
                first["x0"] = float(last["x1"]) + 3
                line_words = [first, *line.words[1:]]
            all_words.extend(line_words)
        else:
            all_words.extend(dict(word) for word in line.words)
        previous_line = line
    return word_runs(all_words)


def split_title_body(runs: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    title: list[dict[str, Any]] = []
    body: list[dict[str, Any]] = []
    saw_bold = False
    in_body = False
    for run in runs:
        if run["bold"]:
            saw_bold = True
        elif saw_bold and re.search(r"[A-Za-zÁÉÍÓÚáéíóúÑñ]", run["text"]):
            in_body = True
        (body if in_body else title).append(run)
    if not saw_bold:
        plain = "".join(run["text"] for run in runs)
        match = re.search(r"(?<=[.:])\s", plain)
        if match:
            title = [{"text": plain[: match.start() + 1], "bold": True, "italic": False}]
            body = [{"text": plain[match.end() :], "bold": False, "italic": False}]
    return title, body


def build_nodes(pdf_path: Path) -> dict[str, Node]:
    nodes: dict[str, Node] = {}
    with pdfplumber.open(pdf_path) as pdf:
        for prefix, definition in REGIONS.items():
            state: dict[str, Any] = {}
            parser = {"a": parse_amazon_marker, "b": parse_beni_marker, "c": parse_chiquitania_marker}[prefix]
            current: Node | None = None
            for line in extract_lines(pdf, definition["pages"]):
                marker = parser(line, state)
                if marker:
                    code, parent, level = marker
                    current = nodes.get(code)
                    if current is None:
                        current = Node(code, parent, level, definition["name"])
                        nodes[code] = current
                        if parent and parent in nodes and code not in nodes[parent].children:
                            nodes[parent].children.append(code)
                    current.lines.append(line)
                elif current is not None:
                    current.lines.append(line)
    return nodes


def component_codes(class_code: str) -> list[str]:
    return [item.strip() for item in re.split(r"[+/]", class_code) if item.strip()]


ALIASES = {
    "b1.4a.2": "b1.4a2",
    "b2.2.1c": "b2.2c",
    "b3.2.d": "b3.2d",
}


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit("Uso: extract-vegetation-legend.py PDF SERIES_JSON OUTPUT_JSON")
    pdf_path = Path(sys.argv[1])
    series_path = Path(sys.argv[2])
    output_path = Path(sys.argv[3])

    nodes = build_nodes(pdf_path)
    serialized_nodes: dict[str, Any] = {}
    for code, node in nodes.items():
        runs = merge_lines(node.lines)
        title, body = split_title_body(runs)
        serialized_nodes[code] = {
            "code": code,
            "parent": node.parent,
            "children": node.children,
            "level": node.level,
            "region": node.region,
            "title": title,
            "body": body,
        }

    classes = sorted(json.loads(series_path.read_text(encoding="utf-8"))["classes"])
    class_map: dict[str, list[dict[str, str]]] = {}
    unresolved: list[str] = []
    for class_code in classes:
        components: list[dict[str, str]] = []
        for original in component_codes(class_code):
            resolved = ALIASES.get(original, original)
            if resolved not in serialized_nodes:
                unresolved.append(original)
            components.append({"code": original, "node": resolved})
        class_map[class_code] = components

    payload = {
        "source": pdf_path.name,
        "regions": {prefix: definition["name"] for prefix, definition in REGIONS.items()},
        "nodes": serialized_nodes,
        "classes": class_map,
        "unresolved": sorted(set(unresolved)),
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({
        "classes": len(class_map),
        "nodes": len(serialized_nodes),
        "unresolved": payload["unresolved"],
        "output": str(output_path),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
