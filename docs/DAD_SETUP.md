# Setting up a second transcription machine

Two parts: **A** is what Chris does once in the Google Cloud console so the new person can
publish. **B** is what the new person (Dad) does on his Windows PC. After both, his Claude Code
session can take a PDF all the way to the live catalog with the `transcribe-chart` skill.

## A. Chris: give Dad publish access (about five minutes)

The publisher uses Dad's own Google login through the `gcloud` command-line tool and the Firebase
Hosting API. No API key, no service account file, no Firebase "account": Firebase is just the
Google Cloud project `scoreshift-reader`.

1. Get the Gmail address Dad will use.
2. Open https://console.cloud.google.com/iam-admin/iam?project=scoreshift-reader
   → **Grant access** → principal = Dad's Gmail → add **two** roles:
   - **Firebase Hosting Admin** (`roles/firebasehosting.admin`) — lets him create versions and
     releases on the site.
   - **Service Usage Consumer** (`roles/serviceusage.serviceUsageConsumer`) — the scripts bill API
     quota to the project (`x-goog-user-project`), which needs this role.
   Nothing for Firestore: catalog charts are static files; the band data stays under the rules
   in `firestore.rules`.
3. If the console refuses a `gmail.com` principal, the organisation's *domain restricted sharing*
   policy is in the way (the project sits in the getapexinsights.com org). Either add an
   exception for that project in Organization Policies → `iam.allowedPolicyMemberDomains`, or
   invite Dad through the Firebase console instead (Project settings → Users and permissions →
   Add member, which applies the same policy). Last resort: create a service account with those
   two roles and give Dad its key file to use with `gcloud auth activate-service-account`; that is
   a long-lived secret on his disk, so prefer the login.
4. Deploy the app once from this checkout (`gcloud auth login`, then `python deploy-hosting.py`)
   so the live app has the catalog loader that shows extra books. Until that deploy, charts Dad
   publishes are on the site but the app does not list them.
5. Send Dad the project. No GitHub account needed on his side: from this folder run
   `git archive --format=zip -o ..\ScoreShift.zip HEAD` and send him the zip (about 30 MB).
   Updates later are a new zip; his `charts\` and `books\` folders are his and survive a
   copy-over. (A collaborator invite to https://github.com/Dilosaurus/score-shift works too if
   he ever wants one.)

## B. Dad: set up the PC (about twenty minutes, once)

Everything below is typed into **PowerShell** (Start menu → type PowerShell). Lines beginning
with `#` are comments.

### 1. Install the tools

```powershell
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Python.Python.3.12 -e
winget install --id Google.CloudSDK -e
```

Close PowerShell and open it again so the new commands are found. Install Claude Code by
following https://docs.anthropic.com/claude-code (the `npm install -g @anthropic-ai/claude-code`
route works once Node is installed) and sign in with your own Claude account.

### 2. Get the project

No GitHub account needed. Chris sends `ScoreShift.zip`. Right-click it → **Extract All…** and
choose your `Documents` folder, so you end up with `Documents\ScoreShift`. Then:

```powershell
cd ~\Documents\ScoreShift
.\setup-dad.ps1
```

(If you ever do get a GitHub account and Chris adds you to the repo, `git clone
https://github.com/Dilosaurus/score-shift.git ScoreShift` does the same and keeps history.)

`setup-dad.ps1` installs the exact JavaScript and Python dependencies and runs the test suite.
It prints `ready` at the end.

### 3. Sign in to Google once

```powershell
gcloud auth login
gcloud config set project scoreshift-reader
```

A browser window opens; pick the Gmail address Chris added. Then prove it works, from the
project folder:

```powershell
python tools\chart\chart.py publish --dry-run
```

It should print `"status": "planned"` (or say nothing is approved yet). If it says
`Reauthentication failed`, run `gcloud auth login` again; if it says `403`, the roles in part A
are missing.

### 4. Transcribe something

Open PowerShell in the project folder and start Claude:

```powershell
cd ~\Documents\ScoreShift
claude
```

Then just tell it, for example:

> Transcribe C:\Users\Dad\Desktop\Blue Bossa.pdf into the catalog. Book: dads-charts, title
> Blue Bossa, composer Kenny Dorham.

Claude reads `CLAUDE.md` and uses the `transcribe-chart` skill. It will show you crops when it
cannot read something and ask; answer with what you see on the paper. At the end it publishes and
gives you the live link. In the app, the chart is under **Catalog → Dad's charts**.

Handy commands (from the project folder):

```powershell
python tools\chart\chart.py status                 # what is transcribed, approved, published
python tools\chart\chart.py publish --verify-only  # is everything approved actually live?
npm test                                           # the app's tests
```

### What lives where

- The scan you gave, the transcription (`chart.json`), notes, and the approval live under
  `charts\<book>\<id>\` and are committed to git so nothing is lost.
- Page images and review renders are rebuilt on demand and are not committed.
- Chris's Real Book and Colorado Cookbook work lives on his computer only; nothing on this PC can
  overwrite it, and his deploys carry your charts over untouched.
