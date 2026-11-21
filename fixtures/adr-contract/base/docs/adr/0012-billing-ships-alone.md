# ADR-012: Billing ships on its own

Status: accepted

Billing must stay deployable on its own, so `src/billing` must never import from `src/orgs`.
