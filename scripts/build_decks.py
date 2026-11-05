#!/usr/bin/env python3
"""content/*.tsv (원본) → www/decks/*.json (앱에 들어가는 덱).

    pip install wordfreq openpyxl
    python3 scripts/build_decks.py                 # 덱 JSON 만들기
    python3 scripts/build_decks.py --review out.xlsx  # 검수용 엑셀도 같이

단어 덱은 wordfreq 빈도(zipf)가 높은 순으로 정렬되어, 자주 쓰는 단어부터 배우게 된다.
"""
import argparse
import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"
OUT = ROOT / "www" / "decks"

WORDFREQ_CREDIT = "단어 선정·정렬에 wordfreq 빈도 데이터 참고 (Robyn Speer 외, CC BY-SA 4.0)"
LICENSE = "CC BY-SA 4.0"

DECKS = [
    {
        "id": "en-words-beginner",
        "file": "words-beginner.tsv",
        "kind": "word",
        "title": "회화 필수 단어 · 초급",
        "description": "알긴 하는데 말할 때 바로 안 나오는 단어 500개 (영 → 한)",
        "columns": ["en", "pos", "ko", "ex", "exKo"],
    },
    {
        "id": "en-words-intermediate",
        "file": "words-intermediate.tsv",
        "kind": "word",
        "title": "회화 필수 단어 · 중급",
        "description": "원어민이 자주 쓰는 단어 300개 + 구동사·관용 표현 200개 (영 → 한)",
        "columns": ["en", "pos", "ko", "ex", "exKo"],
    },
    {
        "id": "en-sentences-beginner",
        "file": "sentences-beginner.tsv",
        "kind": "sentence",
        "title": "회화 필수 문장 · 초급",
        "description": "10가지 상황에서 바로 쓰는 문장 100개 (한 → 영)",
        "columns": ["id", "situation", "ko", "en", "key", "note"],
    },
    {
        "id": "en-sentences-intermediate",
        "file": "sentences-intermediate.tsv",
        "kind": "sentence",
        "title": "회화 필수 문장 · 중급",
        "description": "실제 대화에서 막히는 10가지 상황의 문장 100개 (한 → 영)",
        "columns": ["id", "situation", "ko", "en", "key", "note"],
    },
]


def read_tsv(path, columns):
    rows = []
    with open(path, encoding="utf-8") as f:
        for n, line in enumerate(f, 1):
            line = line.rstrip("\n")
            if not line.strip() or line.startswith("#"):
                continue
            parts = [p.strip() for p in line.split("\t")]
            if len(parts) < len(columns):
                parts += [""] * (len(columns) - len(parts))
            if len(parts) > len(columns):
                sys.exit(f"{path.name}:{n}: 칸이 너무 많아요 ({len(parts)}개): {line}")
            rows.append(dict(zip(columns, parts), _line=n))
    return rows


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def build_words(spec, errors):
    from wordfreq import zipf_frequency

    rows = read_tsv(CONTENT / spec["file"], spec["columns"])
    seen = {}
    items = []
    for r in rows:
        where = f'{spec["file"]}:{r["_line"]}'
        for col in ("en", "pos", "ko", "ex", "exKo"):
            if not r[col]:
                errors.append(f"{where}: '{col}' 칸이 비어 있어요")
        key = r["en"].lower()
        if key in seen:
            errors.append(f"{where}: '{r['en']}' 중복 (줄 {seen[key]})")
        seen[key] = r["_line"]
        zipf = zipf_frequency(r["en"], "en")
        items.append({"id": "w-" + slug(r["en"]), "en": r["en"], "pos": r["pos"], "ko": r["ko"],
                      "ex": r["ex"], "exKo": r["exKo"], "zipf": round(zipf, 2)})
    # 여러 단어로 된 표현(구동사 등)은 wordfreq가 빈도를 높게 추정해서 앞쪽에 몰린다.
    # 그래서 한 단어와 표현을 각각 빈도순으로 정렬한 뒤, 비율대로 고르게 섞는다.
    singles = sorted((it for it in items if " " not in it["en"]), key=lambda it: -it["zipf"])
    phrases = sorted((it for it in items if " " in it["en"]), key=lambda it: -it["zipf"])
    merged, i, j = [], 0, 0
    while i < len(singles) or j < len(phrases):
        # 지금까지 섞인 비율이 전체 비율보다 낮은 쪽을 먼저
        if j < len(phrases) and (i >= len(singles) or j / max(1, i + j) < len(phrases) / len(items)):
            merged.append(phrases[j]); j += 1
        else:
            merged.append(singles[i]); i += 1
    return merged


def build_sentences(spec, errors):
    rows = read_tsv(CONTENT / spec["file"], spec["columns"])
    ids = set()
    items = []
    for r in rows:
        where = f'{spec["file"]}:{r["_line"]}'
        for col in ("id", "situation", "ko", "en"):
            if not r[col]:
                errors.append(f"{where}: '{col}' 칸이 비어 있어요")
        if r["id"] in ids:
            errors.append(f"{where}: id '{r['id']}' 중복")
        ids.add(r["id"])
        if r["key"] and r["key"].lower() not in r["en"].lower():
            errors.append(f"{where}: 핵심 표현 '{r['key']}'이 영어 문장에 없어요")
        item = {k: r[k] for k in ("id", "situation", "ko", "en", "key")}
        if r["note"]:
            item["note"] = r["note"]
        items.append(item)
    return items


def write_review(path, built):
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill

    wb = Workbook()
    wb.remove(wb.active)
    head_fill = PatternFill("solid", fgColor="E0E7FF")
    for deck in built:
        ws = wb.create_sheet(deck["title"].replace("·", "-")[:31])
        if deck["kind"] == "word":
            cols = [("번호", 6), ("단어", 16), ("품사", 8), ("뜻", 24), ("예문", 46), ("예문 해석", 40), ("빈도(zipf)", 10)]
            rows = [[i + 1, it["en"], it["pos"], it["ko"], it["ex"], it["exKo"], it["zipf"]] for i, it in enumerate(deck["items"])]
        else:
            cols = [("번호", 6), ("상황", 12), ("한국어", 34), ("영어", 40), ("핵심 표현", 18), ("메모", 24)]
            rows = [[i + 1, it["situation"], it["ko"], it["en"], it["key"], it.get("note", "")] for i, it in enumerate(deck["items"])]
        cols += [("수정 필요 (O)", 12), ("어떻게 고칠까요?", 36)]
        ws.append([c for c, _ in cols])
        for i, (_, w) in enumerate(cols):
            ws.column_dimensions[chr(65 + i)].width = w
            cell = ws.cell(row=1, column=i + 1)
            cell.font = Font(bold=True)
            cell.fill = head_fill
        for r in rows:
            ws.append(r + ["", ""])
        for row in ws.iter_rows(min_row=2):
            for cell in row:
                cell.alignment = Alignment(wrap_text=True, vertical="top")
        ws.freeze_panes = "B2"
        ws.auto_filter.ref = ws.dimensions
    wb.save(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--review", help="검수용 엑셀 파일 경로")
    args = ap.parse_args()

    errors = []
    built = []
    for spec in DECKS:
        if not (CONTENT / spec["file"]).exists():
            print(f"건너뜀: {spec['file']} 없음")
            continue
        items = build_words(spec, errors) if spec["kind"] == "word" else build_sentences(spec, errors)
        built.append({
            "id": spec["id"], "kind": spec["kind"], "title": spec["title"], "description": spec["description"],
            "lang": "en-US", "version": 1,
            "source": (WORDFREQ_CREDIT + " · 뜻과 예문은 되새김 자체 제작") if spec["kind"] == "word" else "되새김 자체 제작",
            "license": LICENSE, "items": items,
        })

    if errors:
        print("\n".join(errors))
        sys.exit(f"오류 {len(errors)}개")

    OUT.mkdir(parents=True, exist_ok=True)
    for deck in built:
        (OUT / f"{deck['id']}.json").write_text(json.dumps(deck, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"{deck['id']}: {len(deck['items'])}개")
    (OUT / "index.json").write_text(json.dumps([f"{d['id']}.json" for d in built]), encoding="utf-8")

    if args.review:
        write_review(args.review, built)
        print(f"검수용 엑셀: {args.review}")


if __name__ == "__main__":
    main()
