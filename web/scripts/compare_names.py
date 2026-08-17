import json
import re

def norm(s):
    s = s.strip().lower()
    s = s.replace("\u2019", "'").replace("'", "'").replace("-", " ")
    s = re.sub(r"\s+", " ", s)
    return s

with open("tmp_db_people.json", encoding="utf-8") as f:
    db = json.load(f)
with open("tmp_people_import.json", encoding="utf-8") as f:
    xlsx = json.load(f)

db_by_norm = {norm(p["name"]): p for p in db}

missing = []
matched = []
for p in xlsx:
    k = norm(p["name"])
    if k in db_by_norm:
        matched.append({"xlsx": p["name"], "db": db_by_norm[k]["name"], "email": p["email"]})
        continue
    found = None
    for dk, dp in db_by_norm.items():
        if p["first"] in dp["name"] and p["last"].split()[0].replace("-", " ") in dp["name"].replace("-", " "):
            found = dp
            break
    if found:
        matched.append({"xlsx": p["name"], "db": found["name"], "email": p["email"], "fuzzy": True})
    else:
        missing.append(p)

used_db = {m["db"] for m in matched}
extra = [p for p in db if p["name"] not in used_db]

print("matched", len(matched))
print("missing", len(missing))
print("extra in db", len(extra))

with open("tmp_name_diff.json", "w", encoding="utf-8") as f:
    json.dump({"matched": matched, "missing": missing, "extra": extra}, f, ensure_ascii=False, indent=2)
