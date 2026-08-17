import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def norm(s: str) -> str:
    s = s.strip().lower().replace("\u2019", "'").replace("-", " ")
    return re.sub(r"\s+", " ", s)


def main() -> None:
    with open(ROOT / "tmp_name_diff.json", encoding="utf-8") as f:
        diff = json.load(f)

    roster = []
    for m in diff["matched"]:
        roster.append(
            {"name": m["xlsx"], "db_name": m["db"], "email": m["email"]}
        )
    for p in diff["missing"]:
        roster.append({"name": p["name"], "db_name": None, "email": p["email"]})

    renames = {
        norm("בנימין קנוביץ'"): "בני קנוביץ",
        norm("יאיר קצוביץ'"): "יאיר קצוביץ",
        norm("ניר יצחק מימון"): "ניר מימון",
        norm("סאלח גדבאן"): "סלאח גדבאן",
    }
    for r in roster:
        if r["db_name"] is None and norm(r["name"]) in renames:
            r["db_name"] = renames[norm(r["name"])]

    out = ROOT / "src" / "data" / "platoon-d-roster.json"
    out.parent.mkdir(exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(roster, f, ensure_ascii=False, indent=2)
    print(len(roster))


if __name__ == "__main__":
    main()
