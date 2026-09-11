"""Deploy dist/ to Firebase Hosting using the Hosting REST API.

Authenticates with the local gcloud user login (gcloud auth print-access-token), so it
does not need `firebase login`. Usage:

    python deploy-hosting.py            # deploy dist/ to the default site
    python deploy-hosting.py --dry-run  # list files that would be uploaded

Project and site come from .firebaserc / firebase.json next to this script.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
API = "https://firebasehosting.googleapis.com/v1beta1"


def load_config() -> tuple[str, str, dict]:
    rc = json.load(open(os.path.join(HERE, ".firebaserc"), encoding="utf-8"))
    project = rc["projects"]["default"]
    fb = json.load(open(os.path.join(HERE, "firebase.json"), encoding="utf-8"))
    hosting = fb["hosting"]
    return project, hosting.get("site", project), hosting


def access_token() -> str:
    gcloud = shutil.which("gcloud") or shutil.which("gcloud.cmd") or "gcloud"
    out = subprocess.run([gcloud, "auth", "print-access-token"], capture_output=True, text=True, check=True)
    return out.stdout.strip()


class Client:
    def __init__(self, token: str, project: str):
        self.headers = {
            "Authorization": f"Bearer {token}",
            "x-goog-user-project": project,
            "Content-Type": "application/json",
        }

    def call(self, method: str, url: str, body: dict | bytes | None = None, content_type: str | None = None):
        data = None
        headers = dict(self.headers)
        if isinstance(body, dict):
            data = json.dumps(body).encode()
        elif isinstance(body, bytes):
            data = body
            headers["Content-Type"] = content_type or "application/octet-stream"
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                raw = resp.read()
                return json.loads(raw) if raw and resp.headers.get("Content-Type", "").startswith("application/json") else raw
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")
            raise SystemExit(f"{method} {url} -> HTTP {e.code}\n{detail}") from None


def ensure_site(client: Client, project: str, site: str) -> str:
    listing = client.call("GET", f"{API}/projects/{project}/sites")
    for s in listing.get("sites", []):
        if s["name"].endswith("/" + site):
            return s["name"]
    created = client.call("POST", f"{API}/projects/{project}/sites?siteId={site}", {})
    print(f"created site {created['name']}")
    return created["name"]


def collect_files(public_dir: str) -> dict[str, tuple[bytes, str]]:
    """Return {"/path": (gzipped_bytes, sha256_of_gzipped)} for every file under public_dir."""
    files: dict[str, tuple[bytes, str]] = {}
    for root, dirs, names in os.walk(public_dir):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for name in names:
            if name.startswith("."):
                continue
            full = os.path.join(root, name)
            rel = "/" + os.path.relpath(full, public_dir).replace(os.sep, "/")
            with open(full, "rb") as fh:
                gz = gzip.compress(fh.read(), compresslevel=9, mtime=0)
            files[rel] = (gz, hashlib.sha256(gz).hexdigest())
    return files


def version_config(hosting: dict) -> dict:
    config: dict = {}
    headers = []
    for rule in hosting.get("headers", []):
        headers.append({"glob": rule["source"], "headers": {h["key"]: h["value"] for h in rule["headers"]}})
    if headers:
        config["headers"] = headers
    if hosting.get("cleanUrls"):
        config["cleanUrls"] = True
    rewrites = []
    for rule in hosting.get("rewrites", []):
        rewrites.append({"glob": rule["source"], "path": rule["destination"]})
    if rewrites:
        config["rewrites"] = rewrites
    return config


RULES_API = "https://firebaserules.googleapis.com/v1"


def deploy_firestore_rules(client: Client, project: str) -> None:
    """Publish firestore.rules as a new ruleset and point the cloud.firestore release at it."""
    rules_path = os.path.join(HERE, "firestore.rules")
    if not os.path.exists(rules_path):
        print("no firestore.rules next to this script; skipping rules")
        return
    source = open(rules_path, encoding="utf-8").read()
    test = client.call("POST", f"{RULES_API}/projects/{project}:test", {"source": {"files": [{"name": "firestore.rules", "content": source}]}})
    issues = [i for i in test.get("issues", []) if i.get("severity") == "ERROR"]
    if issues:
        raise SystemExit("firestore.rules has errors:\n" + json.dumps(issues, indent=2))
    ruleset = client.call("POST", f"{RULES_API}/projects/{project}/rulesets", {"source": {"files": [{"name": "firestore.rules", "content": source}]}})
    release_name = f"projects/{project}/releases/cloud.firestore"
    body = {"name": release_name, "rulesetName": ruleset["name"]}
    try:
        client.call("PATCH", f"{RULES_API}/{release_name}", {"release": body})
    except SystemExit as e:
        if "HTTP 404" not in str(e):
            raise
        client.call("POST", f"{RULES_API}/projects/{project}/releases", body)
    print(f"firestore rules released: {ruleset['name'].rsplit('/', 1)[-1]}")


def main() -> None:
    dry_run = "--dry-run" in sys.argv
    rules_only = "--rules" in sys.argv
    project, site, hosting = load_config()
    if rules_only:
        deploy_firestore_rules(Client(access_token(), project), project)
        return
    public_dir = os.path.join(HERE, hosting.get("public", "public"))
    files = collect_files(public_dir)
    total = sum(len(gz) for gz, _ in files.values())
    print(f"{len(files)} files, {total / 1e6:.1f} MB gzipped, from {public_dir}")
    if dry_run:
        for path in sorted(files):
            print("  " + path)
        return

    client = Client(access_token(), project)
    site_name = ensure_site(client, project, site)

    version = client.call("POST", f"{API}/{site_name}/versions", {"config": version_config(hosting)})
    version_name = version["name"]
    print(f"version {version_name}")

    populate = client.call(
        "POST",
        f"{API}/{version_name}:populateFiles",
        {"files": {path: digest for path, (_, digest) in files.items()}},
    )
    required = set(populate.get("uploadRequiredHashes", []))
    upload_url = populate["uploadUrl"]
    print(f"{len(required)} of {len(files)} files need upload")
    by_hash = {digest: gz for gz, digest in files.values()}
    for i, digest in enumerate(sorted(required), 1):
        client.call("POST", f"{upload_url}/{digest}", by_hash[digest])
        if i % 10 == 0 or i == len(required):
            print(f"  uploaded {i}/{len(required)}")

    client.call("PATCH", f"{API}/{version_name}?updateMask=status", {"status": "FINALIZED"})
    release = client.call("POST", f"{API}/{site_name}/releases?versionName={version_name}", {})
    print(f"released {release['name']}")
    deploy_firestore_rules(client, project)
    print(f"live: https://{site}.web.app")


if __name__ == "__main__":
    main()
