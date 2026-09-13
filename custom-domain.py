"""Point a custom domain at the ScoreShift Firebase Hosting site.

    python custom-domain.py add score-shift.com          # register the apex domain
    python custom-domain.py add www.score-shift.com --redirect-to score-shift.com
    python custom-domain.py status                       # DNS records still needed + cert state
    python custom-domain.py authorize score-shift.com    # allow Firebase Auth sign-in from the domain

Uses the same gcloud user token as deploy-hosting.py. GoDaddy is never touched: the DNS records
printed by `status` are added by hand in GoDaddy's DNS manager.
"""
import json
import sys

sys.path.insert(0, __file__.rsplit("\\", 1)[0].rsplit("/", 1)[0] or ".")
from importlib import import_module

dh = import_module("deploy-hosting")

API = dh.API
IDP = "https://identitytoolkit.googleapis.com/admin/v2"


def domains(client, project, site):
    out = client.call("GET", f"{API}/projects/{project}/sites/{site}/customDomains")
    return out.get("customDomains", []) if isinstance(out, dict) else []


def show(d):
    name = d["name"].rsplit("/", 1)[-1]
    print(f"\n== {name}")
    for key in ("ownershipState", "certState", "hostState"):
        print(f"  {key}: {d.get(key)}")
    if d.get("redirectTarget"):
        print(f"  redirects to: {d['redirectTarget']}")
    for issue in d.get("issues", []):
        print(f"  issue: {issue.get('message')}")
    updates = d.get("requiredDnsUpdates")
    if not updates:
        print("  DNS: nothing pending")
        return
    for group in updates.get("desired", []):
        for rec in group.get("records", []):
            print(f"  ADD    {rec['type']:<5} host={rec['domainName']:<24} value={rec['rdata']}")
    for group in updates.get("discovered", []):
        for rec in group.get("records", []):
            if rec.get("requiredAction") == "REMOVE":
                print(f"  REMOVE {rec['type']:<5} host={rec['domainName']:<24} value={rec['rdata']}")


def main():
    project, site, _ = dh.load_config()
    client = dh.Client(dh.access_token(), project)
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "add":
        domain = sys.argv[2]
        body = {}
        if "--redirect-to" in sys.argv:
            body["redirectTarget"] = sys.argv[sys.argv.index("--redirect-to") + 1]
        op = client.call("POST", f"{API}/projects/{project}/sites/{site}/customDomains?customDomainId={domain}", body)
        print("operation:", op.get("name"), "done" if op.get("done") else "pending")
        for d in domains(client, project, site):
            if d["name"].endswith("/" + domain):
                show(d)
    elif cmd == "status":
        for d in domains(client, project, site):
            show(d)
    elif cmd == "authorize":
        domain = sys.argv[2]
        cfg = client.call("GET", f"{IDP}/projects/{project}/config")
        allowed = cfg.get("authorizedDomains", [])
        want = [x for x in (domain, "www." + domain) if x not in allowed]
        if not want:
            print("already authorized:", allowed)
            return
        cfg = client.call("PATCH", f"{IDP}/projects/{project}/config?updateMask=authorizedDomains", {"authorizedDomains": allowed + want})
        print("authorized domains now:", cfg.get("authorizedDomains"))
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
