# 12 · Einstellungen einer Fortbildung, Zertifikatsfelder und VNR

**Zuweisung: Philipp Burka**
**Bereich:** Verwaltung (Konsole) · **Dauer:** ca. 30 Minuten

## Ziel

Prüfen, dass alle Angaben, die auf der Teilnahmebescheinigung landen oder die
Punktemeldung ermöglichen, vollständig erfassbar sind — und dass fehlende
Angaben vor dem Veröffentlichen auffallen, nicht danach.

## Voraussetzungen

- Eine Test-Fortbildung im Mandanten `ds`
- **Nicht** auf der MEDICE-Fortbildung arbeiten

## Testschritte

1. Reiter **Einstellungen** einer Fortbildung öffnen.
2. Der Reihe nach ausfüllen: Veranstalter, Ort, anerkennende Ärztekammer,
   wissenschaftliche Leitung, Ausstellungsort.
3. CME-Punkte und Kategorie setzen.
4. Die Anforderung „angesehene Videoinhalte" auf verschiedene Werte setzen.
5. Stempel und Unterschrift hochladen.
6. Eine **VNR** eintragen. Eine offensichtlich falsche probieren (z. B.
   `1234`). Was passiert?
7. Das **VNR-Passwort** eintragen. Speichern. Neu laden — wird das Passwort
   angezeigt oder nur, dass eines hinterlegt ist?
8. Veröffentlichen versuchen, während ein Zertifikatsfeld leer ist.
9. Alle Felder füllen und veröffentlichen.
10. Reiter **Referenten** und **Evaluationsbogen** ansehen und je einen Eintrag
    anlegen.

## Erwartetes Ergebnis

- Schritt 7: Das Passwort wird **niemals** wieder angezeigt. Es steht nur da,
  dass eines hinterlegt ist. Wird es angezeigt, ist das **blockierend**.
- Schritt 8: Ablehnung mit Nennung des fehlenden Feldes.

## Wichtig zur Einordnung

- Zu Schritt 6: Die VNR wird derzeit **nicht auf Gültigkeit geprüft** — eine
  falsche wird angenommen. Das ist bekannt und in Klärung; die Prüfregel ist
  noch nicht bestätigt und wir wollten sie nicht raten. Bitte nur melden, **was
  passiert**, nicht als Fehler bewerten.
- Zu Schritt 7: Die Passwortlänge unterscheidet sich je Ärztekammer (4- bis
  8-stellig). Dass keine Längenprüfung stattfindet, ist Absicht.

## Rückmeldung bitte mit

Die Liste der Felder aus Schritt 2, mit Vermerk, welche selbsterklärend waren
und welche nicht.
