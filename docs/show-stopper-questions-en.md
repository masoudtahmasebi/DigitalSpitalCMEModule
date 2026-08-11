# The open questions, in plain English

Written to be forwarded. `docs/show-stoppers.md` holds the full reasoning; this
is only the questions, in the words the person answering them uses.

Two audiences: the **Ärztekammer Westfalen-Lippe** (accreditation rules) and
**MEDICE** (their systems, their content, their decisions). Nothing here is an
engineering question — every one of them is outside our control, and the code is
waiting on the answer or has made an assumption we need confirmed.

---

## For the Ärztekammer Westfalen-Lippe (`zertifizierung@aekwl.de`)

### Q1 — When does an on-demand course "end"? · **most consequential**

We must report a physician's points within **8 days of the event ending**. For a
live seminar that is obvious: everyone leaves at 17:00 and the clock starts.

This course has no room and no 17:00. Every physician takes it at a different
moment across the year. **Eight days from what?**

The Anerkennungsbescheid gives two dates and neither works:

- If the clock runs from **13.10.2025** (the Maßnahme date), it expired in
  October 2025 and every submission is already late.
- If it runs from **12.10.2026** (validity end), nothing may be reported until
  the accreditation is nearly over.

**Our reading:** your own Teilnahmebescheinigung template says _"am \_\_\_\_\_\_\_\_
als on-demand-Webinar teilgenommen hat"_ — one blank date, per participant,
filled in by the Veranstalter. On an on-demand format the only date that blank
can hold is the day that physician finished. So the event "ends", for each
physician, on the day they complete it.

**Please confirm that reading.** It is one sentence, and the platform already
behaves this way.

**Why it matters more than it looks:** the EIV API declares a `beginn` and an
`ende` for the VNR and refuses any `teilnahmedatum` outside that window with a 406. If that `ende` is 13.10.2025, **every completion this platform reports will
be rejected** — regardless of what our own deadline logic says. That turns this
from "which date do we pass?" into "is reporting possible at all?"

### Q2 — Does an emailed PDF certificate satisfy the "Originalstempel" requirement?

The Bescheid obliges the Veranstalter to provide each participant with a named
Teilnahmebescheinigung. We generate it as a PDF, carrying the course's stamp and
the scientific lead's signature as images.

**Is a PDF delivered by download or email acceptable, or does the certificate
have to carry a physical original stamp?**

If a physical stamp is required, the whole certificate delivery path has to
change, and we need to know before launch rather than after the first physician
asks for a paper copy.

### Q3 — Which point flags may a completion claim?

The EIV `push_teilnahme` call carries `punkte_basis_flag` and
`punkte_lernerfolg_flag` as two separate fields. The Bescheid awards this
Fortbildung **4 points, Kategorie D**, with 70% on the Lernerfolgskontrolle as a
_condition_ of awarding them — which does not obviously map onto two flags.

**Should a completed participation set both flags, or only the basis flag?**

We currently send both, deliberately: claiming credit the event does not carry
fails loudly (406/422) and we can fix it inside the 8-day window; _not_ claiming
credit that was earned is accepted silently and the physician is short of points
with nothing anywhere saying so.

---

## For MEDICE

### Q4 — Rotate the API key in the WordPress plugin · **today**

The plugin source you sent contains a **live API key in plaintext**. Anyone with
a copy of that file has it. Please rotate it and confirm when done.

### Q5 — Revoke the offline refresh token, and stop requesting `offline_access` · **today**

The token response you shared includes an **offline refresh token, which never
expires**. Please revoke it and remove `offline_access` from the scopes the
plugin requests.

### Q6 — Add an audience mapper to Keycloak, or no physician can sign in

Your tokens carry `aud: account`. Our API validates the audience and rejects
them — by design, and we will not weaken that check: an API that accepts tokens
minted for a different audience accepts tokens from anywhere.

**Please add an audience mapper so the token carries our API's audience.** Until
then, no MEDICE physician can log in at all.

### Q7 — How will the WordPress plugin hold the token?

The plugin as supplied **stores no token**. The access token lives 600 seconds.
So a physician would be signed out mid-video.

**How do you want this to work?** The realistic options are a refresh flow in
the plugin, or physicians signing in on our portal instead of inside WordPress.
This is a decision only you can make; it changes what we build.

### Q8 — Is the video rule 80% or 100%? · in writing, please

A physician must watch a stated proportion of the material before the
Lernerfolgskontrolle unlocks. We have **80%** configured. Please confirm the
number in writing — it is the gate that decides whether a CME point is earned,
and "we thought it was 80" is not a defensible answer to an audit.

### Q9 — Which SMTP account sends the ADHS mails, and with which credentials?

Certificates, password resets and invitations are sent from an address the
physician will see and may reply to. **Which MEDICE mailbox should that be?**
We need host, port, username, password and the From address.

### Q10 — The production EIV API base URL

The test system is documented; **the production base URL is not published
anywhere we can find**. Please ask EIV support for it.

### Q11 — Test-system credentials for EIV

We cannot prove our EIV client works against anything but our own mock until we
can talk to the real test system. **Please obtain test credentials from EIV
support.** One command then answers Q1 and Q3 factually rather than by reading.

### Q12 — The VNR format, and whether any VNR-less completion already exists

Please confirm the exact VNR for this course, and whether any physician has
already completed it in a way that was never reported.

### Q13 — The accreditation expires 12.10.2026, and a platform change must be notified

Moving this course onto a new platform is a change the Kammer must be told
about. **Has that notification been sent?**

---

## For DigitalSpital (internal)

- **Hetzner account ownership and DNS** — who owns the account the production
  host lives in, and who can change DNS.
- **The VNR password was shared over chat.** It must be rotated and then set on
  the Fortbildung's settings screen in the console, where it is encrypted at
  rest. It must never be put in an environment file — the deploy refuses that
  by design.
- **Scope decision on four layout features** that are not in the 140 hours.
