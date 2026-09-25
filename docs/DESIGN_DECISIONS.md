# Design decisions: what this system deliberately does not do

The original spec for LexIntel states its own thesis clearly:

> "This project should be designed as a decision-support system, not an AI
> that decides guilt, innocence, sentencing, or legal outcomes."

Two requested features would have broken that thesis, so they were built
differently. This document explains what was asked for, what was built
instead, and why -- so the reasoning travels with the code instead of
living only in a chat transcript.

## 1. Facial micro-expressions to detect fear, anxiety, or deception

**What was asked for:** analyze a witness/defendant's face for micro
expressions, fear, anxiety, hesitation, and "overthinking" while they
testify, presumably as a signal about whether they're telling the truth.

**What was built instead:** the courtroom stand (`app/api/routers/courtroom.py`,
`frontend/src/pages/app/courtroom/Stand.tsx`) does two things only --
records *who* is at the stand (the clerk confirms identity; 1:1 face
verification against a consented reference photo is a disabled hook in
`app/agents/courtroom_session.py` that reports "not run" until a model is
deliberately wired in after legal review) and *records* their statement for
the case file, with a live transcript. Nothing analyzes expression, tone, or
affect.

**Why:** the evidence here is genuinely mixed, not uniformly settled, so
it's worth being specific about it rather than waving at "junk science."
Some lab studies report high accuracy for deep-learning models trained to
spot deception from facial action units in scripted, high-stakes-question
paradigms. But the research that most resembles a real courtroom --
real stakes, real judges, unscripted speech -- tells a different story:
a comparison of human judges against machine-learning models found that
both trained and untrained human observers distinguish liars from
truth-tellers only slightly above chance. A survey of expert deception
researchers found over 80% agreement on exactly one point across the
whole field: that gaze aversion, one of the most commonly assumed "tells,"
is not actually diagnostic of lying. And true micro-expressions are rare
enough -- roughly 2% of facial movements in one analysis -- that they're a
thin signal even before you ask whether that signal means what people
assume it means.

That gap between curated-lab accuracy and real-world reliability is a big
part of why this kind of evidence isn't admissible in most courts. It also
points at the deeper problem for a courtroom deployment specifically:
fear, hesitation, and a delayed response look identical whether they come
from lying, from courtroom anxiety that any innocent person can feel,
from a trauma response (especially relevant for victims and witnesses in
violent-crime or assault cases), from a language or cultural gap, or from
being neurodivergent. A system that scores those signals wouldn't be
detecting deception -- it would quietly penalize people for how their
anxiety happens to present, and would do it inside a system with the
court's authority behind it. That's a worse failure mode than doing
nothing, because it looks objective while encoding bias.

*Sources consulted while writing this: a ScienceDirect comparison of human
judges vs. ML models on deception detection from video interviews; a
"Psychology Town" summary of the expert-consensus survey on nonverbal
deception cues; general micro-expression frequency research. Treat this
as a starting point for further reading, not a legal citation.*

## 2. The AI issuing the actual judgment/verdict

**What was asked for:** after statements are collected, have the AI judge
the case according to the law.

**What was built instead:** `POST /cases/{id}/ruling` (`app/api/routers/cases.py`)
only accepts a ruling entered by a person with a judicial role -- there is
no code path anywhere in this repo where an agent populates a `CaseRuling`.
The AI's job ends at compiling the record: the timeline (Module 2), the
relevant law with citations (Module 6), similar precedent (Module 5), and
a workload-priority recommendation with a visible explanation (Module 4).
A judge reads that record and decides.

As of this pass, that boundary is enforced at the HTTP layer, not just
structurally: `Depends(require_role(SystemRole.JUDGE))` on the endpoint
means an unauthenticated or non-judge request never reaches the handler
at all (401/403), and `entered_by` isn't even a field the request can
set -- it's read from the authenticated judge's own token server-side, so
there's no value a caller could send to make an AI-originated or
mis-attributed ruling land in that column. Tested end-to-end through the
real API in `backend/tests/test_e2e_auth.py`, including the specific case
of an authenticated-but-wrong-role account being rejected (403), not just
an anonymous one (401) -- the two failure modes a real auth system needs
to get right are both covered.

**Why:** this one is less about contested evidence and more structural.
Due process -- the right to have a human weigh the evidence, to appeal, to
confront the reasoning behind a decision -- is not a formality; it's the
mechanism that makes a legal system accountable at all. An AI verdict
engine has no way to be cross-examined, has no license to practice law,
and cannot be appealed to in the way a judge can. No court system
anywhere currently permits this, and no credible legal-tech vendor builds
it, for the same reason. It's also, again, exactly what the original spec
already asked for.

## 3. Complaint submission is the one public, unauthenticated endpoint

Everything requires a staff account except filing a complaint
(`POST /complaints`) and tracking it (`POST /complaints/track`, which needs
the reference number *and* the private tracking code). This is a deliberate,
narrow exception, not an oversight: `pages/public/FileComplaint.tsx` and
`TrackComplaint.tsx` are the citizen portal -- a member of the public filing
a complaint has no staff account and shouldn't need one. Both are
rate-limited per IP.
Everything downstream of intake (`GET /complaints` for triage, case
creation, prioritization, evidence handling, the ruling itself) requires
authentication like everything else. If you extend this system, keep
that line where it is: public-facing intake stays public, everything a
court employee does with what comes out of it stays behind auth.

## 4. All AI runs on the court's own server, and generated text is checked, not trusted

LexIntel uses no cloud AI service and needs no API key. Case files, statements
and complaints never leave the machine.

That choice shapes the design. The only writing model that fits beside the rest
of the system on modest hardware is small (qwen2.5 1.5B). A model that size
paraphrases well but does not reliably follow "cite your sources", and it
sometimes adds a sentence of its own. So:

- **Most AI jobs don't use a writing model at all.** Classification, duplicate
  detection, similar cases, offence mentions, source comparison, summaries
  and key passages use a small multilingual embedding model. It answers
  "which texts mean the same thing?", can't invent text, gives the same
  answer every time, and explains itself by pointing at the text it matched.
  Summaries are extractive: they quote original sentences, so a statement
  summary can never put words in a witness's mouth.
- **Drafts are checked against their sources, not trusted.** Research answers
  and case briefs stream to the reader, then every sentence is matched against
  the sources. Citations are computed from that match, not taken from the
  model. Sentences that match nothing are marked "not found in the sources".
  Any date, time or amount that the sources do not contain makes its sentence
  unsupported no matter how well it reads -- in testing the model restated a
  09:15 collision as "2:30 PM", which matched in meaning and would otherwise
  have passed. Drafts that mostly don't match, or that drift into another
  language, are withheld, and the reader keeps the quoted law or key facts.
- **The non-AI result always comes first.** Research shows the in-force
  articles and key passages before any draft starts. Briefs show the quoted
  key facts. Model off, busy, out of memory or failed means "no draft", never
  "no answer".
- **Drafting is greedy, not creative.** Sampling is off (temperature 0).
  Measured on the same notes: at 0.1 the model attributed one party's injury
  to another and repeated whole sentences; at 0 it stays with the notes and
  gives the same answer every time, which also makes a draft reproducible
  when someone asks where a sentence came from.

**What the checks do not catch.** They test whether a sentence matches a
source and whether its figures appear there. A small model can still join two
facts that belong apart -- writing that a driver "left the scene after 40
minutes" when the note says he left *before* officers arrived and returned
after 40 minutes. Every figure there exists in the source, so the check passes
it. Prompt variants were measured against this: stricter wording invented a
causal link, "one fact per sentence" confused the owner with the driver, and a
20-word limit produced accurate but telegraphic English. The limit is the
model's size, not the instructions, so the draft is labelled as a draft, the
quoted notes sit directly beneath it, and the interface says plainly that
facts can be joined wrongly.

| Component | Without the writing model | Without the embedding model |
|---|---|---|
| Complaint triage | Unaffected | Bilingual keywords, labelled "keyword-based" |
| Duplicates, similar cases | Unaffected | Word overlap |
| Offence mentions / source comparison | Unaffected | Cited laws / entity check only |
| Summaries, key passages | Unaffected | Word-frequency selection |
| Research | Articles + key passages, no draft | Keyword retrieval only |
| Case brief | Quoted key facts, no draft | Quoted key facts (word frequency) |
| Prioritisation, NER, OCR, speech-to-text | Unaffected | Unaffected |

## 5. Courtroom audio stays on the court's own servers

The stand records the microphone (and camera, if enabled) in the browser and
transcribes it with a local faster-whisper model -- no cloud speech service.
Witness and victim testimony is among the most sensitive data a court holds;
sending it to a third-party API by default would be a data-protection decision
nobody consciously made. The clerk reviews and corrects every transcript at
step-down, and the full recording is re-transcribed at higher quality
afterwards; the clerk's corrections are never overwritten.

## 6. Photos and look

The interface uses the official UAE Design System package (MIT licence) for
its palette, fonts and components, and licensed stock photography (see
`frontend/public/images/CREDITS.md`). It deliberately does not use the state
emblem or any official seal, and every public page says it is not an official
government service -- a complaint portal that looks official could make a
citizen believe they had filed with the government itself.

## 7. Time is the court's time, and dates are worded in the reader's language

Hearings belong to the courthouse, not to the machine someone reads the screen
on. Every instant is stored in UTC and rendered in `Asia/Dubai`
(`frontend/src/lib/format.ts`), so a clerk on a laptop still set to another
country sees a 10:00 hearing as 10:00, not as 11:30. Dates that carry no time
-- a statutory deadline, the day a law came into force -- are calendar dates
and are deliberately *not* converted: shifting them by four hours moves them
to the day before.

Error text is written once, in English, where the error is raised, and is put
into Arabic on the way out (`app/core/messages.py`), chosen by the
`Accept-Language` the frontend sends. Threading a language argument through
105 raise sites would have guaranteed that some of them drifted; one table at
the edge cannot. A message with no Arabic wording is sent unchanged rather
than dropped, so the worst case is an English sentence, not a blank one -- and
`tests/test_messages.py` reads the routers and fails if a message is raised
that has no wording, which is how that worst case stays hypothetical.

Arabic also gets full month and weekday names. date-fns abbreviates Arabic by
cutting the word and adding a kashida ("سبتـ", "ثلا"), which reads as a broken
word rather than as an abbreviation.

## What this means if you extend the system

- Don't add a field like `emotion_state`, `deception_score`, or
  `truthfulness` anywhere in `app/models/schemas.py` or `app/db/orm_models.py`. If you find yourself
  wanting one, that's a sign the feature belongs in a research prototype
  explicitly labeled as unvalidated, not in a system a real court uses.
- Don't add a code path that lets an agent write to `CaseRuling`. Keep
  ruling entry behind `Depends(require_role(SystemRole.JUDGE))`
  (`app/api/deps.py`), always, and never add an `entered_by`-like field to
  a request body that a caller could populate directly -- take it from
  the authenticated user, the way `enter_ruling()` in `routers/cases.py` does.
- Every AI-touched endpoint should keep returning an explanation alongside
  its output (Module 12) -- that's what makes it possible for a human to
  catch the system being wrong.
- Show dates through the helpers in `frontend/src/lib/format.ts` rather than
  `toLocaleString` or `new Date()` directly, and compute "today" with
  `courtDay()`. A raw `new Date().toISOString().slice(0, 10)` is the court's
  today only for readers who happen to sit east of UTC.
- A new `HTTPException` needs a line in `app/core/messages.py`. The message
  test will tell you if you forget.
- Anything biometric (face verification, signature matching) should stay
  narrowly scoped (1:1 verification against a specific consented
  reference, not open-ended identification), should have a manual
  fallback that's just as easy to use as the automated path, and should
  go through your court's data-protection and legal review before
  production use -- this repo is a working prototype, not a compliance
  sign-off. The UAE's Federal Decree-Law No. 45 of 2021 on the Protection
  of Personal Data is the relevant starting point for that review; this
  isn't legal advice, and you should involve counsel before deploying
  anything that captures biometric data of real case parties.
