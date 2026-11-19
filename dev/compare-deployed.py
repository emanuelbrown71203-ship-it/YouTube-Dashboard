"""Compare the edge function Supabase is running with the files in supabase/functions/yt-api.

Usage: python3 -I dev/compare-deployed.py <saved get_edge_function result>

The saved result is the JSON the Supabase connector's get_edge_function returns (it is long, so
the session saves it to a file). Every deployed file is compared byte for byte with the file of
the same name in the repository, and files missing on either side are listed. Exits 0 only when
the two match exactly. Nothing is written anywhere.
"""
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
FUNCTION_DIR = os.path.join(HERE, "..", "supabase", "functions", "yt-api")


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    with open(sys.argv[1], "rb") as fh:
        text = fh.read().decode("utf-8")  # strict: fail loudly on anything odd
    start = len(text) - len(text.lstrip())
    doc, end = json.JSONDecoder().raw_decode(text, start)
    if text[end:].strip():
        print("unexpected text after the JSON", file=sys.stderr)
        return 2

    print(f"deployed version {doc.get('version')}, status {doc.get('status')}, verify_jwt {doc.get('verify_jwt')}")
    deployed = {}
    for entry in doc["files"]:
        base = entry["name"].replace("\\", "/").rstrip("/").rsplit("/", 1)[-1]
        if base in deployed:
            print(f"two deployed files share the name {base!r}", file=sys.stderr)
            return 2
        deployed[base] = entry["content"].encode("utf-8")

    local = {name: open(os.path.join(FUNCTION_DIR, name), "rb").read() for name in sorted(os.listdir(FUNCTION_DIR))}
    ok = True
    for name in sorted(set(deployed) | set(local)):
        if name not in deployed:
            print(f"MISSING ON SUPABASE  {name}")
            ok = False
        elif name not in local:
            print(f"ONLY ON SUPABASE     {name}")
            ok = False
        elif deployed[name] != local[name]:
            print(f"DIFFERENT            {name}  (deployed sha256 {hashlib.sha256(deployed[name]).hexdigest()[:12]}, "
                  f"repository {hashlib.sha256(local[name]).hexdigest()[:12]})")
            ok = False
        else:
            print(f"same                 {name}")
    print("MATCH: the live function is exactly the repository's" if ok else "NO MATCH")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
