# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- feat(phase2): refunds/disputes, invoices/plans, Security Center, Developer tab, and security fixes (3b6fc1f)
- feat(paypal): official server SDK, Guard-wrapped agent toolkit, and PayPal JS buttons (650012d)
- feat(ui): Aurora themes, spaces, approvals inbox, and Zen pause (5148ca9)
- feat(guard): mandate payment links, scan-to-pay QR, and settlement timeline (895afe9)
- feat(brand): rebrand to AgentPaL, add tab deep links, smooth spend chart (c2287ef)
- feat(ui): 12-screen light redesign, dark mode, gradient themes, glass sidebar, Cmd+K command bar (01bd4e3)

### Fixed
- fix(security): edge-only client IP (CF-Connecting-IP > True-Client-IP > shared 'unknown'), IPv6 /64 buckets, no role note (7f1c47e)
- fix(security): global failed-PIN exponential backoff (30s..5m cap) that never blocks existing owner sessions (4f1265f)
- fix(security): PIN hardening (12+ chars, session secret, lockout), RBAC fails score in demo mode, honest audit counts (61bc449)
- fix(security): default-viewer RBAC with PIN-signed owner sessions, real health checks, route tests, lint, vitest 4 (331860e)
- fix(security): stop model-minted mandates, self-approved trade-offs and model-chosen amounts (046bc03)
- fix(ui): keep the AgentPaL wordmark readable in the mobile header (504cf20)
- fix(render): include devDependencies at build time (3a35509)

### Changed
- chore(render): use free plan (a5e1e47)
- chore: update license holder (cc63fb7)
