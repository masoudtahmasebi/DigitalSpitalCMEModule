# 10 · Lernerfolgskontrolle anlegen und ändern

**Zuweisung: Philipp Burka**
**Bereich:** Verwaltung (Konsole) · **Dauer:** ca. 35 Minuten

## Ziel

Prüfen, dass eine Prüfung auch dann noch änderbar ist, wenn sie schon jemand
geschrieben hat — und dass dabei nichts verlorengeht, was als Nachweis gebraucht
wird.

> **Hinweis:** Bis vor Kurzem war das nicht möglich — eine einzige erfasste
> Antwort hat die Prüfung dauerhaft eingefroren. Das ist geändert. Dieses Ticket
> prüft die Änderung, deshalb bitte gründlich.

## Voraussetzungen

- Eine Test-Fortbildung im Mandanten `ds`
- **Dieses Ticket erst nach dem nächsten Deploy durchführen.** Vorher zeigt die
  Konsole noch den alten Stand.

## Testschritte

1. In einem Modul eine Lernerfolgskontrolle anlegen.
2. Drei Fragen anlegen: eine mit **einer** richtigen Antwort, eine mit
   **mehreren**, eine unvollständige.
3. Speichern versuchen, solange eine Frage **keine** richtige Antwort hat. Was
   passiert?
4. Bei „eine richtige Antwort" **zwei** Optionen als richtig markieren.
   Speichern.
5. Fragen umsortieren. Speichern. Neu laden — stimmt die Reihenfolge?
6. Eine Frage löschen, die **noch niemand** beantwortet hat.
7. **Jetzt als Teilnehmer die Prüfung schreiben** (anderer Browser oder privates
   Fenster), damit Antworten erfasst sind.
8. Zurück in die Verwaltung. Trägt die beantwortete Frage jetzt einen Hinweis
   („In Verwendung", „1 Antwort erfasst")?
9. **Diese beantwortete Frage entfernen.** Was sagt der Bestätigungsdialog?
10. Speichern. Ist die Frage aus der Prüfung verschwunden?
11. Nachsehen, ob irgendwo steht, **wie viele Fragen entfernt wurden**.
12. Als Teilnehmer die Prüfung erneut öffnen: Wird die entfernte Frage noch
    gestellt?
13. Beim betroffenen Teilnehmer nachsehen: **Steht sein altes Ergebnis noch?**

## Erwartetes Ergebnis

- Schritt 3 und 4: Beide werden abgelehnt, mit einer Meldung, die die Frage
  benennt.
- Schritt 9: Der Dialog sagt, dass die Frage **nicht gelöscht, sondern aus der
  Prüfung entfernt** wird — und dass abgegebene Versuche ihr Ergebnis behalten.
- Schritt 11: Es steht dort, dass Fragen entfernt wurden und warum sie
  gespeichert bleiben.
- Schritt 12: Die entfernte Frage wird **nicht mehr gestellt**.
- Schritt 13: **Das alte Ergebnis ist unverändert.** Das ist der wichtigste
  Punkt dieses Tickets.

## Besonders achten auf

Schritt 13. Wenn ein bereits erzieltes Ergebnis sich nachträglich verändert,
ist das **blockierend** und bitte sofort melden — daran hängt ein CME-Punkt.

## Rückmeldung bitte mit

Screenshot des Bestätigungsdialogs aus Schritt 9 und des Hinweises aus
Schritt 11.
