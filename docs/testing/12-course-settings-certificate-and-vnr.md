# 12 · Course settings, certificate fields and VNR

**Assignee: Philipp Burka**
**Area:** Admin console · **Duration:** approx. 30 minutes

## Goal

Check that everything which ends up on the Teilnahmebescheinigung, or which
enables the Punktemeldung, can be captured in full — and that missing entries
are noticed before publishing, not after.

## Prerequisites

- A test course in the `ds` tenant
- **Do not** work on the MEDICE course

## Steps

1. Open a course's **Einstellungen** tab.
2. Fill in, in order: Veranstalter, Ort, recognising Ärztekammer,
   wissenschaftliche Leitung, place of issue.
3. Set CME points and Kategorie.
4. Set the "video content watched" requirement to various values.
5. Upload stamp and signature.
6. Enter a **VNR**. Try an obviously wrong one (e.g. `1234`). What happens?
7. Enter the **VNR password**. Save. Reload — is the password shown, or only
   the fact that one is stored?
8. Try to publish while a certificate field is empty.
9. Fill everything and publish.
10. Look at the **Referenten** and **Evaluationsbogen** tabs and create one
    entry in each.

## Expected

- Step 7: the password is **never** shown again. It only says that one is
  stored. If it is shown, that is **blocking**.
- Step 8: refusal, naming the missing field.

## Important context

- On step 6: the VNR is currently **not validated** — a wrong one is accepted.
  This is known and being clarified; the validation rule is not yet confirmed
  and we did not want to guess it. Please only report **what happens**, not as a
  defect.
- On step 7: password length differs by Ärztekammer (4 to 8 digits). The absence
  of a length check is deliberate.

## Please report with

The list of fields from step 2, noting which were self-explanatory and which
were not.
