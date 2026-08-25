# 16 · Konten, Rollen und Zwei-Faktor

**Zuweisung: Philipp Burka**
**Bereich:** Verwaltung (Konsole) · **Dauer:** ca. 35 Minuten

## Ziel

Prüfen, dass jede Rolle genau die Bildschirme sieht, die sie auch benutzen darf
— und dass niemand einen Knopf angeboten bekommt, den das System anschließend
verweigert.

## Voraussetzungen

- Ein Konto mit Administratorrechten
- Eine Authenticator-App für den zweiten Faktor
- **Zwei Browser** oder ein privates Fenster, um parallel als zweite Rolle zu
  arbeiten

## Testschritte

1. **Einstellungen → Konten** öffnen.
2. Ein neues Konto einladen. Den Einladungstext lesen: Ist klar, **was** man da
   bekommt — ein Link, ein Kennwort, ein Code?
3. Die Einladung im zweiten Browser annehmen und das Konto einrichten.
4. **Dieselbe Einladung ein zweites Mal** benutzen. Was passiert?
5. Zwei-Faktor einrichten und einmal an- und abmelden.
6. Prüfen, ob die Konsole anbietet, den **eigenen** zweiten Faktor
   zurückzusetzen.
7. Das neue Konto mit einer **eingeschränkten Rolle** versehen.
8. Als dieses Konto anmelden und **jeden Menüpunkt anklicken**, der angeboten
   wird.
9. Notieren, ob irgendein angebotener Menüpunkt zu „keine Berechtigung" führt.
10. Ein Konto deaktivieren, während es in einem anderen Browser angemeldet ist.
    Was passiert dort beim nächsten Klick?
11. **Einstellungen → Sicherheit** öffnen und ansehen, was dort steht.

## Erwartetes Ergebnis

- Schritt 4: Eine gebrauchte Einladung funktioniert **kein zweites Mal**.
- Schritt 6: Der eigene zweite Faktor lässt sich **nicht** selbst zurücksetzen —
  und wenn der Knopf fehlt, steht dort, **warum** und wer es kann.
- **Schritt 9 ist der Kern dieses Tickets: Es darf keinen einzigen geben.** Ein
  Menüpunkt, der zu „keine Berechtigung" führt, ist ein Befund — bitte mit
  Rolle und Menüpunkt melden.
- Schritt 10: Der Zugang endet, nicht erst beim nächsten Anmelden.

## Besonders achten auf

Schritt 2. Der Einladungstext wurde schon einmal als Passwort missverstanden.
Bitte wörtlich zurückmelden, was dort steht, und ob es eindeutig war.

## Rückmeldung bitte mit

Eine Tabelle: **Rolle × angeklickter Menüpunkt × hat funktioniert (ja/nein)**.
Das ist die Rückmeldung, die hier am meisten wert ist.
