# S17 · Request to MEDICE: add an audience mapper to the Keycloak client

**Status:** ready to send · **To:** MEDICE Keycloak / IT administrator ·
**Cc:** MEDICE project lead · **Raised:** 29.07.2026 · **Blocks:** launch

Two versions below. The **plain-language summary** is for the PM and can go in
the body above the technical part, or be sent alone if the technical detail
reaches the administrator another way. The **technical request** is the one the
Keycloak administrator acts on.

The value in `<AUDIENCE>` is ours to choose and must match on both sides — see
"Before sending" at the bottom.

---

## Plain-language summary (for the PM)

> **In one sentence:** MEDICE's login works perfectly, but the tokens it issues
> do not say they are meant for our platform, so our server refuses every one of
> them and no physician can open a course.
>
> This is a **five-minute configuration change in MEDICE's Keycloak**, not a
> development task, and there is nothing we can build on our side that fixes it
> without weakening the security check that protects the CME data.
>
> It has to be done before launch on 06.09. Until it is, a physician who logs in
> successfully still sees an error.

---

## Technical request (German — for the Keycloak administrator)

> **Betreff:** ADHS-Fortbildungsplattform — Audience Mapper für den Client
> `gemeinsam-adhs-begegnen` erforderlich (vor Go-Live 06.09.)
>
> Hallo <Name>,
>
> für die Anbindung der CME-Fortbildungsplattform an euer Keycloak fehlt noch
> **eine Konfigurationsänderung auf eurer Seite**. Ohne sie weist unsere API
> derzeit **jedes** Access Token ab, auch wenn die Anmeldung selbst
> einwandfrei funktioniert.
>
> **Das Problem**
>
> Die Access Tokens aus `login.medice.com` enthalten:
>
> ```
> aud: "account"                        ← Keycloak-Standard
> azp: "gemeinsam-adhs-begegnen"
> ```
>
> `account` ist Keycloaks eigener interner Client. Das Token enthält damit
> keinen Hinweis darauf, dass es für unsere API bestimmt ist.
>
> Unsere API prüft jedes Bearer Token serverseitig gegen euer JWKS auf
> Signatur, Issuer, **Audience** und Ablauf. Diese Prüfung ist Teil der
> Sicherheitsarchitektur der Plattform (die Fortbildung führt zu einer
> gesetzlich gemeldeten CME-Punktevergabe, daher wird der Anmeldung des
> einbettenden Systems nicht vertraut). Ein Token mit `aud: "account"` fällt
> durch die Audience-Prüfung.
>
> Wir haben das mit realistisch geformten Tokens gegen unsere echte
> Prüffunktion verifiziert:
>
> | `aud` im Token              | Ergebnis                       |
> | --------------------------- | ------------------------------ |
> | `"account"`                 | **abgelehnt** (wrong_audience) |
> | `"<AUDIENCE>"`              | akzeptiert                     |
> | `["account", "<AUDIENCE>"]` | akzeptiert                     |
>
> Die dritte Zeile ist wichtig: **`account` muss nicht entfernt werden.** Es
> genügt, unsere Audience zusätzlich aufzunehmen. Bestehende Integrationen
> bleiben damit unberührt.
>
> **Die Änderung**
>
> Im Realm, in dem der Client `gemeinsam-adhs-begegnen` liegt:
>
> 1. **Client scopes → Create client scope**
>    - Name: z. B. `ds-education-audience`
>    - Type: `Default`
>    - Protocol: `openid-connect`
>    - Include in token scope: `On`
> 2. In diesem Scope: **Mappers → Configure a new mapper → Audience**
>    - Name: z. B. `ds-education-api-audience`
>    - **Included Custom Audience:** `<AUDIENCE>`
>    - Add to access token: `On`
>    - (Add to ID token: nicht erforderlich)
> 3. **Clients → `gemeinsam-adhs-begegnen` → Client scopes → Add client scope**
>    → den neuen Scope als **Default** hinzufügen.
>
> **Prüfung, ob es gewirkt hat**
>
> Ein neu ausgestelltes Access Token auf <https://jwt.io> einfügen (oder den
> Payload dekodieren) und den Claim `aud` ansehen. Erwartet:
>
> ```
> "aud": ["account", "<AUDIENCE>"]
> ```
>
> Sobald das der Fall ist, funktioniert die Anmeldung an der Plattform ohne
> weitere Änderungen auf unserer Seite. Eine kurze Rückmeldung mit dem
> tatsächlichen `aud`-Wert genügt uns.
>
> **Zeitrahmen**
>
> Der Go-Live ist für den **06.09.2026** geplant. Solange die Änderung nicht
> aktiv ist, erhält jede Ärztin und jeder Arzt nach erfolgreicher Anmeldung
> eine Fehlermeldung und kann keine Fortbildung öffnen. Wir können das erst
> nach eurer Änderung end-to-end testen, daher wäre eine Umsetzung **in dieser
> Woche** sehr hilfreich.
>
> Für Rückfragen stehen wir jederzeit zur Verfügung — auch gern kurz per
> Telefon oder in einer gemeinsamen Session am Keycloak.
>
> Viele Grüße
> <Name>
> DigitalSpital

---

## If they say the mapper is not possible

Do **not** offer to accept `azp` instead in the first mail. It is one line of
code, it would work, and it is the wrong line: `aud` says _who the token is
for_, `azp` says _which client asked for it_. Accepting `azp` alone means
accepting any token that client ever minted, for any service — the
confused-deputy problem the OAuth security BCP names explicitly.

If they genuinely cannot add the mapper, the fallback is a **per-project
opt-in**: a column recording "this binding accepts `azp = X` in place of an
audience", so the weakening is visible in the data, scoped to one tenant, and
reviewable. That is auth code and carries the human review gate (CLAUDE.md §2).
It is not written on spec, and it should not be offered before the standard
change has been refused.

---

## Before sending

1. **Decide `<AUDIENCE>` and set our side to match.** It is a value we choose,
   not a fixed string: the API takes the expected issuer and audience from the
   project's own binding row (`projects.keycloak_audience`), so whatever is
   agreed has to be entered in the console for the MEDICE project as well.
   `ds-education-api` is a reasonable proposal; MEDICE may prefer a name in
   their own convention, which is fine — the only requirement is that both
   sides carry the same string.
2. **Confirm the realm and client name** — `gemeinsam-adhs-begegnen` is from the
   token response of 29.07. If MEDICE has since renamed the client, the
   instructions still apply, but name the right one.
3. **Fill in the recipient's name** and the sender.
4. **Send S18 in the same message or immediately after.** The refresh token
   pasted into the project chat on 29.07 is an _offline_ token that never
   expires and should be revoked; the same administrator does both, and both
   are one-line asks.

## After it lands

Confirming the mapper exists is not the same as confirming a physician can log
in. The whole platform is tested on the `ds` tenant with local participants,
which never touches MEDICE's Keycloak — so this defect is structurally invisible
to every suite we run (CLAUDE.md §9.13).

**One real MEDICE account, signing in at `/medice`, opening one course.** That
is the check that closes S17, and it cannot be done before the change lands.
