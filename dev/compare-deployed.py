"""Compare the edge function Supabase is running with what this repository deploys.

Usage: python3 -I dev/compare-deployed.py <saved get_edge_function result>
       python3 -I dev/compare-deployed.py --bundle <saved get_edge_function result>

The function is deployed as one bundled file, dev/deploy/yt-api/index.js, built from the source in
supabase/functions/yt-api by `npm run bundle:fn` (the source has grown past what one deploy call can
carry). With --bundle, the deployed files are compared with that bundle, which must be newer than
every source file; without it, with the source files themselves (how it was deployed before).

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
SOURCE_DIR = os.path.join(HERE, "..", "supabase", "functions", "yt-api")
BUNDLE_DIR = os.path.join(HERE, "deploy", "yt-api")


def main() -> int:
    args = sys.argv[1:]
    bundle = args[:1] == ["--bundle"]
    if bundle:
        args = args[1:]
    if len(args) != 1:
        print(__doc__)
        return 2
    FUNCTION_DIR = BUNDLE_DIR if bundle else SOURCE_DIR
    if bundle:
        built = os.path.join(BUNDLE_DIR, "index.js")
        if not os.path.exists(built):
            print("no bundle yet: run npm run bundle:fn", file=sys.stderr)
            return 2
        newest = max(os.path.getmtime(os.path.join(SOURCE_DIR, n)) for n in os.listdir(SOURCE_DIR))
        if os.path.getmtime(built) < newest:
            print("the bundle is older than the source: run npm run bundle:fn again", file=sys.stderr)
            return 2
    with open(args[0], "rb") as fh:
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
    what = "the bundle built from the repository" if bundle else "the repository's"
    print(f"MATCH: the live function is exactly {what}" if ok else "NO MATCH")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
