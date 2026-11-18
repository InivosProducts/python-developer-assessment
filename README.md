# Python Developer Assessment (Vercel + Mailgun)

A rotating 20-question test (14 multiple-choice + 6 free-text) that candidates take in a browser. When they submit, the server grades the test and emails the **candidate name, score, time taken and the full answers** to your hiring inbox through Mailgun.

- Questions come from 8 modules of skill-maps.com/domains/python-developer (Databases & ORMs and Web Frameworks & APIs have been removed). The bank has 77 questions: 61 multiple-choice and 16 free-text.
- Every candidate gets a different paper: 2–3 questions per module, with question and option order shuffled.
- **Grading happens on the server.** The browser never receives correct answers, explanations or marking keys.
- **Time is measured on the server.** The start time sits inside an HMAC-signed token, so the candidate can't change it. Sessions expire after 3 hours.
- No database is needed. It runs on Vercel's free (Hobby) plan with no npm dependencies.

```
api/start.js     POST: creates a paper and returns a signed token plus questions (without answers)
api/submit.js    POST: verifies the token, grades, emails the result via Mailgun
lib/bank.js      question bank with answers (server only)
lib/paper.js     paper builder, token signing, grading
public/index.html  candidate UI
scripts/selftest.js  local test: `npm test`
```

## 1. Set up Mailgun (free)

1. Sign up at https://www.mailgun.com/ (the free plan allows about 100 emails a day).
2. **Sending → Domains**: on the free plan you get a sandbox domain (`sandboxXXXX.mailgun.org`).
   - A sandbox domain can only email **authorized recipients**. Add your hiring inbox under the sandbox domain's *Authorized Recipients*, and accept the confirmation email that Mailgun sends to it.
   - To send from your own domain (e.g. `mg.inivosglobal.com`), add it in Mailgun and create the DNS records it shows (SPF, DKIM, MX). Then use that domain instead.
3. **API Security → API keys**: create a key and copy it. Note whether your account is in the **US or EU** region.

## 2. Deploy to Vercel (free)

**Option A: GitHub (recommended)**
1. Push this folder to a GitHub repository (private is fine).
2. At https://vercel.com/new, import the repository. Framework preset: **Other**. Leave the build settings empty.
3. Before you click Deploy, add the environment variables below.

**Option B: Vercel CLI**
```bash
npm i -g vercel
cd python-developer-assessment
vercel            # first run links or creates the project
# add the env vars (vercel env add NAME production), then:
vercel --prod
```

### Environment variables (Project → Settings → Environment Variables)

| Name | Example | Notes |
|---|---|---|
| `MAILGUN_API_KEY` | `key-…` | Required. Your Mailgun private API key. |
| `MAILGUN_DOMAIN` | `sandbox123.mailgun.org` | Required. |
| `MAILGUN_REGION` | `us` or `eu` | Defaults to `us`. |
| `RESULTS_TO` | `hiring@inivosglobal.com` | Required. Comma-separate for several addresses. On a sandbox domain each address must be an authorized recipient. |
| `RESULTS_FROM` | `Python Assessment <postmaster@sandbox123.mailgun.org>` | Optional. |
| `TOKEN_SECRET` | 32+ random characters | Required. Generate one with `openssl rand -hex 32`. |
| `RESULTS_TIMEZONE` | `Asia/Colombo` | Time zone for the start and finish times in the email. |
| `SHOW_SCORE_TO_CANDIDATE` | `true` / `false` | Whether the candidate sees their score after submitting. |

Redeploy after you change any variable.

## 3. Test it

- Open the deployed URL, enter a test name and submit. The email should arrive within a minute (check spam the first time).
- If the email fails, the candidate is told to contact you, and the full result text is printed in **Vercel → Project → Logs** (search for `EMAIL FAILED`), so nothing is lost.
- Locally: `npm test` checks 1,000 generated papers, makes sure no answers reach the browser, and confirms tampered tokens are rejected (Mailgun is stubbed).

## Notes and limits

- Free-text scores are keyword-based estimates (0–2 in 0.5 steps). The email shows each answer, the key points found and the model answer, so a marker can adjust the score.
- With no database there's no single-use enforcement. A candidate could restart and get a new paper, but each attempt is emailed with its own timestamps, so restarts are visible.
- To edit questions, change `lib/bank.js`. Each module needs at least 3 multiple-choice and 1 free-text question.
# python-developer-assessment
