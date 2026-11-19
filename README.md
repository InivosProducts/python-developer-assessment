# Python Developer Assessment (Vercel + Mailgun)

A rotating 20-question test (14 multiple-choice + 6 free-text) that candidates take in a browser. When they submit, the server grades the test and emails the **candidate name, score, time taken and the full answers** to your hiring inbox through Mailgun.

- Questions come from 8 modules of skill-maps.com/domains/python-developer (Databases & ORMs and Web Frameworks & APIs have been removed). The bank has 77 questions: 61 multiple-choice and 16 free-text.
- Every candidate gets a different paper: 2–3 questions per module, with question and option order shuffled.
- **Grading happens on the server.** The browser never receives correct answers, explanations or marking keys.
- **Time is measured on the server.** The start time sits inside an HMAC-signed token, so the candidate can't change it. Sessions expire after 3 hours.
- **Email is verified before the test starts.** The candidate enters their name and email, receives a 6-digit code, and enters it to begin. The verified email appears in the result email (and as its Reply-To).
- **Wrong addresses are caught before any email is sent.** Common typos get a "Did you mean …?" prompt (`gmial.com`, `.con`), and the domain must exist and accept email (DNS check). An optional Mailgun mailbox check can also reject addresses that don't exist.
- No database is needed. It runs on Vercel's free (Hobby) plan with no npm dependencies.

```
api/config.js    GET: tells the page whether email verification is on
api/verify-email.js  POST: emails a 6-digit code and returns a signed challenge token
api/start.js     POST: checks the code, creates a paper and returns a signed token plus questions (without answers)
api/submit.js    POST: verifies the token, grades, emails the result via Mailgun
lib/bank.js      question bank with answers (server only)
lib/paper.js     paper builder, token signing, grading
lib/verify-email.js  stateless code generation and checking
lib/email-check.js   typo, domain (DNS) and optional Mailgun mailbox checks
lib/mail.js      Mailgun sender
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
| `EMAIL_VERIFICATION` | `on` / `off` | Defaults to `on`. Candidates must confirm their email with a code before starting. Set `off` to go back to name-only. |

| `EMAIL_DOMAIN_CHECK` | `on` / `off` | Defaults to `on`. Rejects addresses whose domain doesn't exist or can't receive email. |
| `MAILGUN_VALIDATION` | `on` / `off` | Defaults to `off`. Also asks Mailgun's Email Validation API whether the mailbox exists. Uses `MAILGUN_API_KEY`; validation is usually a paid Mailgun feature. If it's unavailable, candidates are let through and `MAILGUN VALIDATION UNAVAILABLE` is logged. |

> **Email verification and the Mailgun sandbox:** a sandbox domain only delivers to *authorized recipients*, so candidates won't receive their codes. For real use, send from your own verified domain (see step 1). For a quick sandbox trial, add the test candidate's address as an authorized recipient, or set `EMAIL_VERIFICATION=off`.

Redeploy after you change any variable.

## 3. Test it

- Open the deployed URL, enter a test name and your email, enter the code you receive, then submit. The email should arrive within a minute (check spam the first time).
- If the email fails, the candidate is told to contact you, and the full result text is printed in **Vercel → Project → Logs** (search for `EMAIL FAILED`), so nothing is lost.
- Locally: `npm test` checks 1,000 generated papers, makes sure no answers reach the browser, confirms the email code is enforced, and confirms tampered tokens are rejected (Mailgun is stubbed).

## Notes and limits

- Free-text scores are keyword-based estimates (0–2 in 0.5 steps). The email shows each answer, the key points found and the model answer, so a marker can adjust the score.
- How verification works without a database: the code is never stored. `/api/verify-email` returns a challenge token signed with `TOKEN_SECRET` that holds the name, email, a 15-minute expiry and an HMAC of the code. `/api/start` recomputes the HMAC from the code the candidate types. The test token then carries the verified email, so it can't be swapped later.
- How the email checks work: no check can prove a mailbox exists except delivering to it, so the 6-digit code stays the final proof. The checks before it stop obvious mistakes: a typo prompt the candidate can override ("No, use what I typed"), a DNS lookup that the domain has mail servers (MX records, or an address record as the standard fallback), and optionally Mailgun's validation, which checks the mailbox itself. If DNS or Mailgun is down or slow, the candidate is let through rather than blocked.
- Because nothing is stored, the server can't count wrong guesses or rate-limit code requests per address. The 15-minute expiry and 1-in-a-million code keep guessing impractical; if you see abuse, add Vercel's Firewall rate limiting on `/api/verify-email` and `/api/start`.
- With no database there's no single-use enforcement. A candidate could restart and get a new paper, but each attempt is emailed with its own timestamps, so restarts are visible.
- To edit questions, change `lib/bank.js`. Each module needs at least 3 multiple-choice and 1 free-text question.
# python-developer-assessment
