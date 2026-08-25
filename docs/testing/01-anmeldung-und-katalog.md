# 01 · Anmeldung und Fortbildungskatalog

**Zuweisung: Philipp Burka**
**Bereich:** Teilnehmenden-Portal · **Dauer:** ca. 20 Minuten

## Ziel

Prüfen, dass eine Ärztin sich anmelden kann und den Katalog so vorfindet, dass
sie ohne Erklärung weiß, was sie anklicken soll.

## Voraussetzungen

- Zugangsdaten für den Mandanten `ds` (Testmandant)
- Die Portal-Adresse mit Mandantenpfad, also `…/ds`

## Testschritte

1. Portal-Adresse **ohne** Mandantenpfad aufrufen. Was passiert?
2. Portal-Adresse **mit einem erfundenen** Mandantenpfad aufrufen, z. B.
   `…/gibtesnicht`. Was steht auf dem Bildschirm?
3. Portal-Adresse mit `…/ds` aufrufen und anmelden.
4. Mit **falschem Passwort** anmelden. Was sagt die Meldung?
5. Angemeldet: den Katalog ansehen. Die Filter durchklicken.
6. Nach einem Begriff suchen, der zu nichts passt.
7. Seite neu laden. Bin ich noch angemeldet?
8. Abmelden, dann die Zurück-Taste des Browsers drücken.

## Erwartetes Ergebnis

- Schritt 2 nennt **keine** existierenden Mandanten. Die Liste unserer Kunden
  ist nichts, was ein beliebiger Besucher erfragen können soll — dass die
  Antwort deshalb wenig hilfreich ist, ist beabsichtigt.
- Schritt 4 verrät nicht, ob die Adresse existiert.
- Schritt 6 sagt, dass nichts gefunden wurde, und bietet einen Weg zurück.
- Schritt 8 zeigt keine angemeldeten Inhalte mehr.

## Besonders achten auf

- Sind die Überschriften über den Katalogabschnitten verständlich?
- Ist auf einer Kachel erkennbar, **wie viele CME-Punkte** es gibt und **wie
  lange** die Fortbildung dauert?
- Steht irgendwo Englisches?

## Rückmeldung bitte mit

Screenshot des Katalogs in voller Breite, und die Antwort auf: _Wüsste eine
Ärztin, die diese Seite zum ersten Mal sieht, wo sie klicken muss?_
