# Python Developer Assessment (Vercel + Mailgun)

A rotating 20-question test (14 multiple-choice + 6 free-text) that candidates take in a browser. When they submit, the server grades the test and emails the **candidate name, score, time taken and the full answers** to your hiring inbox through Mailgun.

- Questions come from 8 modules of skill-maps.com/domains/python-developer (Databases & ORMs and Web Frameworks & APIs have been removed). The bank has 87 questions: 71 multiple-choice and 16 free-text, including 10 GitHub Actions interview questions in Testing & CI/CD.
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
api/submit.js    POST: verifies the token, grades, emails the result via Mailgun, returns an encrypted result file
api/admin.js     POST: opens a result file for the hiring team (used by admin.html)
lib/bank.js      loads the question bank from lib/bank.enc (encrypted with TOKEN_SECRET)
lib/bank-crypto.js  encrypts and decrypts the question bank file
lib/bank.enc     the question bank with answers, encrypted (server only)
scripts/bank.js  `npm run bank:decrypt` / `npm run bank:encrypt` for editing questions
lib/paper.js     paper builder, token signing, grading
lib/verify-email.js  stateless code generation and checking
lib/email-check.js   typo, domain (DNS) and optional Mailgun mailbox checks
lib/mail.js      Mailgun sender (with retries)
lib/receipt.js   encrypts and opens result files
lib/report.js    builds the result report (email and admin view)
public/index.html  candidate UI
public/admin.html  result viewer for the hiring team
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
| `ADMIN_PASSWORD` | 16+ random characters | Turns on the result viewer at `/admin.html`. Leave unset to keep it off. Generate one with `openssl rand -base64 18`. |
| `EMAIL_VERIFICATION` | `on` / `off` | Defaults to `on`. Candidates must confirm their email with a code before starting. Set `off` to go back to name-only. |

| `EMAIL_DOMAIN_CHECK` | `on` / `off` | Defaults to `on`. Rejects addresses whose domain doesn't exist or can't receive email. |
| `MAILGUN_VALIDATION` | `on` / `off` | Defaults to `off`. Also asks Mailgun's Email Validation API whether the mailbox exists. Uses `MAILGUN_API_KEY`; validation is usually a paid Mailgun feature. If it's unavailable, candidates are let through and `MAILGUN VALIDATION UNAVAILABLE` is logged. |

> **Email verification and the Mailgun sandbox:** a sandbox domain only delivers to *authorized recipients*, so candidates won't receive their codes. For real use, send from your own verified domain (see step 1). For a quick sandbox trial, add the test candidate's address as an authorized recipient, or set `EMAIL_VERIFICATION=off`.

Redeploy after you change any variable.

## 3. Test it

- Open the deployed URL, enter a test name and your email, enter the code you receive, then submit. The email should arrive within a minute (check spam the first time).
- If the email fails, the candidate is told to contact you, and the full result text is printed in **Vercel → Project → Logs** (search for `EMAIL FAILED`), so nothing is lost.

## 4. When a result email doesn't arrive

No database is used, so results are recovered from one of these, in order:

1. **Vercel logs** (Project → Logs). Search for the candidate's name. Every submission writes `SUBMIT RECEIVED`, then `RESULT EMAILED … mailgun_id=…` or `EMAIL FAILED … error=…`.
   - `RESULT EMAILED`: Mailgun accepted it. Search Mailgun → **Logs** for that id to see whether it was delivered, bounced or is waiting.
   - `EMAIL FAILED`: the error says why (e.g. `401` wrong key or region, `403`/`400` sandbox recipient not authorised). The full result and a `RESULT FILE: PDA1.…` line follow it.
   - No `SUBMIT RECEIVED` at all: the submission never reached the server (the candidate closed the page, or lost their connection).
   - Vercel keeps these logs only for a short time on the Hobby plan (about an hour), so check soon or use option 2.
2. **The candidate's result file.** After submitting, every candidate can download an encrypted result file, and is asked to send it to you if the email fails. Open it at `https://<your-site>/admin.html` with `ADMIN_PASSWORD` to see the full report, download it, or email it to `RESULTS_TO` again. You can also paste a `RESULT FILE: PDA1.…` line from the logs there.

The result file is encrypted with a key derived from `TOKEN_SECRET` (AES-256-GCM), so candidates can't read the answers or change their score, and only a deployment with the same `TOKEN_SECRET` can open it. If you change `TOKEN_SECRET`, older result files can no longer be opened.

Failed Mailgun requests are retried automatically (up to 3 attempts) when the cause is temporary: network errors, timeouts, rate limits or Mailgun server errors. Configuration errors are not retried.

The admin page has one password and no account lockout. Use a long random password, and consider adding `/api/admin` to your Vercel Firewall rate-limit rule, e.g. `^/api/(verify-email|start|admin)$`.
- Locally: `TOKEN_SECRET=… npm test` checks 1,000 generated papers, makes sure no answers reach the browser, confirms the email code is enforced, and confirms tampered tokens are rejected (Mailgun is stubbed).

## Notes and limits

- Free-text scores are keyword-based estimates (0–2 in 0.5 steps). The email shows each answer, the key points found and the model answer, so a marker can adjust the score.
- How verification works without a database: the code is never stored. `/api/verify-email` returns a challenge token signed with `TOKEN_SECRET` that holds the name, email, a 15-minute expiry and an HMAC of the code. `/api/start` recomputes the HMAC from the code the candidate types. The test token then carries the verified email, so it can't be swapped later.
- How the email checks work: no check can prove a mailbox exists except delivering to it, so the 6-digit code stays the final proof. The checks before it stop obvious mistakes: a typo prompt the candidate can override ("No, use what I typed"), a DNS lookup that the domain has mail servers (MX records, or an address record as the standard fallback), and optionally Mailgun's validation, which checks the mailbox itself. If DNS or Mailgun is down or slow, the candidate is let through rather than blocked.
- To see the checks working, open **Vercel → Project → Logs** and search for `EMAIL CHECK`. Each code request writes one line, for example `EMAIL CHECK result=rejected reason=domain address=j***@nosuch.com typo=none dns=no-domain mailgun=off`. The address is masked; `dns` is `ok`, `no-domain`, `no-mail` or `unknown` (lookup failed, candidate let through); `mailgun` is `off`, the Mailgun result (`deliverable`, `undeliverable`, …) or `unavailable`.
- Because nothing is stored, the server can't count wrong guesses or rate-limit code requests per address. The 15-minute expiry and 1-in-a-million code keep guessing impractical; if you see abuse, add Vercel's Firewall rate limiting on `/api/verify-email` and `/api/start`.
- With no database there's no single-use enforcement. A candidate could restart and get a new paper, but each attempt is emailed with its own timestamps, so restarts are visible.
- To edit questions, see **Editing the question bank** below. Each module needs at least 3 multiple-choice and 1 free-text question.

## Editing the question bank

The question bank (questions, correct answers, marking keys and model answers) is stored encrypted in `lib/bank.enc`, using AES-256-GCM with a key derived from `TOKEN_SECRET`. Anyone can see the file in the repository, but without `TOKEN_SECRET` they can't read it, and any change made to it without the secret makes the app refuse to load it.

To change questions you need the same `TOKEN_SECRET` the deployed app uses, in your environment or as `TOKEN_SECRET=…` in a local `.env` file:

```bash
npm run bank:decrypt   # lib/bank.enc -> lib/bank.source.js (git-ignored)
# edit lib/bank.source.js
npm run bank:encrypt   # lib/bank.source.js -> lib/bank.enc, deletes the source
TOKEN_SECRET=… npm test
git add lib/bank.enc && git commit
```

- `lib/bank.source.js` is git-ignored, so the plain bank isn't committed by accident.
- **If you change `TOKEN_SECRET`, re-encrypt the bank first:** decrypt with the old secret, then encrypt with the new one, and deploy both together. Otherwise the app can't load its questions (and older result files stop opening too).
- `npm test` needs the real `TOKEN_SECRET` because it loads the encrypted bank.
- Commits made before the bank was encrypted still contain the plain `lib/bank.js` in the git history. If the repository is public, those questions should be treated as exposed.
# python-developer-assessment
