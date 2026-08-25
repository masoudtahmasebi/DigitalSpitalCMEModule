# Testpaket CME-Modul — Übersicht

**Zuweisung: Philipp Burka** — gilt für dieses Dokument und für jedes Ticket in diesem Ordner.

Jede Datei in diesem Ordner ist ein eigenständiges Test-Ticket. Sie sind so
geschnitten, dass eines in 20–40 Minuten durchführbar ist und ohne Kenntnis der
anderen funktioniert.

## Reihenfolge

Die Lernenden-Tickets (01–08) bilden zusammen eine durchgehende Fortbildung und
bauen inhaltlich aufeinander auf — in dieser Reihenfolge getestet ist es eine
Sitzung statt acht. Die Verwaltungs-Tickets (09–16) sind unabhängig.

---

## Vor dem ersten Test — bitte einmal lesen

### 1. Nicht auf der akkreditierten MEDICE-Fortbildung testen

Die Fortbildung **„ADHS Akademie adult"** trägt die echte VNR
`2760552025919300018` aus dem Anerkennungsbescheid der ÄKWL. Für sie gilt:

- **70 % richtig beantwortete Fragen sind Auflage der Anerkennung**, keine
  Einstellung.
- Der Bescheid verlangt, dass **Änderungen jeglicher Art der ÄKWL zeitnah
  schriftlich mitzuteilen** sind. Fragen ändern, Module umsortieren oder Punkte
  anpassen ist so eine Änderung.

**Zum Testen bitte entweder den Mandanten `ds` verwenden oder eine neue
Fortbildung im Entwurfsstatus anlegen.** Ein Entwurf ist für Teilnehmende
unsichtbar und lässt sich beliebig verändern.

### 2. Die Punktemeldung an die Ärztekammer ist derzeit blockiert

Die Schnittstelle hält für diese VNR einen **eintägigen** Anerkennungszeitraum
(13.10.2025) für eine zwölfmonatige On-Demand-Fortbildung. `push_teilnahme`
weist jedes Teilnahmedatum außerhalb dieses Zeitraums mit HTTP 406 ab —
**derzeit wird also jede Punktemeldung abgelehnt.**

Das ist bekannt, bei der ÄKWL angefragt und **kein Fehler, den es zu melden
gilt**. Alles davor — Fortbildung, Prüfung, Evaluation, EFN, Bescheinigung —
funktioniert unabhängig davon.

### 3. Die Teilnahmebescheinigung kommt bei Abschluss, nicht nach der Meldung

Bewusst so entschieden: Die Bescheinigung wird ausgestellt, sobald die
Fortbildung abgeschlossen ist. Sie wartet **nicht** auf die Punktemeldung.

### 4. Bitte immer dazuschreiben, was gelaufen ist

Bei jeder Rückmeldung hilfreich:

- **Browser und Gerät** (z. B. „Chrome 141, MacBook")
- **Adresse aus der Adresszeile** — jeder Bildschirm hat eine eigene
- **Uhrzeit** der Beobachtung
- **Screenshot**, wo möglich

Der letzte Punkt ist der wichtigste: Ob etwas fehlt oder nur auf dem
betrachteten Server noch nicht ausgeliefert ist, lässt sich im Browser nicht
unterscheiden — mit Adresse und Uhrzeit lässt es sich klären.

---

## Rückmeldung, bitte in dieser Form

Pro Beobachtung:

| Feld           |                                    |
| -------------- | ---------------------------------- |
| **Ticket**     | z. B. 03                           |
| **Schritt**    | z. B. 4                            |
| **Erwartet**   | was laut Ticket passieren sollte   |
| **Beobachtet** | was tatsächlich passiert ist       |
| **Schwere**    | blockierend / störend / kosmetisch |
| **Screenshot** |                                    |

„Störend" und „kosmetisch" bitte genauso melden wie „blockierend". Zwölf
kosmetische Beobachtungen auf einem Bildschirm sind zusammen kein kosmetisches
Problem.

## Wenn etwas offensichtlich fehlt

Bitte trotzdem melden — aber mit dem Hinweis, ob es **ganz** fehlt oder ob nur
ein Knopf dafür nicht auffindbar war. Das sind zwei verschiedene Befunde und
beide sind wertvoll.
