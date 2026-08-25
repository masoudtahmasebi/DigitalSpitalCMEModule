# 15 · Appearance and wording

**Assignee: Philipp Burka**
**Area:** Admin console · **Duration:** approx. 25 minutes

## Goal

Check that a customer gets their own look and their own wording without anyone
having to touch code.

## Prerequisites

- Working in the `ds` tenant
- A logo file

## Steps

1. Open **Einstellungen → Erscheinungsbild**.
2. Change the brand colour. Save. Check the portal.
3. Upload a logo. Check the portal.
4. Enter an **invalid** colour (e.g. `rot` or `#12`). What happens?
5. Upload a font, if offered.
6. Open **Einstellungen → Texte**.
7. Override a text — e.g. the catalogue heading.
8. Check in the portal that the new text appears.
9. Clear the override again. Does the default text come back?
10. Check whether you can tell **where** a text appears before changing it.
11. Switch the console language to **EN** and look at a few screens.

## Expected

- Step 4: the entry is **refused**, and the message names the field. The entered
  value itself need **not** appear in the message.
- Step 8: the change appears in the portal, possibly after a reload.
- Step 9: clearing restores the default rather than leaving an empty line.
- Step 11: the console is English throughout — **except** the specialist terms
  Lernerfolgskontrolle, Teilnahmebescheinigung, Punktemeldung,
  Anerkennungsbescheid, Ärztekammer, EFN, VNR. Those appear verbatim on the
  Ärztekammer's documents and stay German deliberately.

## Pay particular attention to

Step 10. A list of text snippets with no indication of where they appear is only
usable by trial and error. Please report if that is the case.

## Please report with

Before/after screenshots of the portal following the colour and logo change.
