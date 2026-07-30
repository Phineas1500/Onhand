# Releasing Onhand

Order matters: the published privacy copy must never describe less reading
than the shipped extension performs.

1. Verify the branch: `npm run build:extension`, then the full suite set
   (`test:browser-runtime-regressions`, `test:page-toolkit-regressions`,
   `test:routing-probe`, `test:agent-trajectory-eval`,
   `test:agent-runtime-modules`, `test:sidebar-regressions`,
   `website:check-tools`, `website:check-store`, `smoke:browser-runtime`).
2. Bump the extension version; run `npm run website:sync-store` after the
   store serves it (the badge lags until then — `website:check-store` tells you).
3. Deploy the website (privacy.html changes go live here) **with or before**
   the store submission — over-disclosing during the review window is fine,
   the reverse is not.
4. Submit the extension update; paste `docs/STORE_LISTING.md` into the store
   dashboard in the same sitting; confirm the privacy-practices declarations
   still match (data categories rarely change; triggers might).
5. After rollout: reload the unpacked extension on dev profiles, and run one
   live Tacoma-style cross-tab turn as a smoke check.

The browser-runtime regression suite enforces copy/runtime consistency (the
privacy-copy tripwire and the settled-rule prompt sentences); if it is green,
the release is internally consistent.
