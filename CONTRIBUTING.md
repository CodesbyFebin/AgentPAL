# Contributing to AgentPaL

First off — thank you. Every issue report, doc fix and PR makes this project better.
## Development setup
Prerequisites:
- **Node.js 22.12+** (CI uses Node 22) or **Node.js 20.19+**, and **npm**
```bash
git clone https://github.com/CodesbyFebin/AgentPAL.git
cd AgentPAL
npm ci
npm test
npm run lint
```

Use `npm run test:coverage` to generate LCOV coverage for the server code. The
Coverage workflow keeps the report as a GitHub Actions artifact and uploads it
to Codecov when the repository has a `CODECOV_TOKEN` Actions secret.
## How to contribute
1. **Open an issue first** for anything non-trivial — we would rather align before you invest hours.
2. Fork the repo and create a branch: `git checkout -b feat/my-feature`.
3. Make your change, with tests.
4. Run the test suite and linter locally — CI will run them again.
5. Open a pull request using the PR template.
## Commit convention
We follow [Conventional Commits](https://www.conventionalcommits.org):
- `feat: add X` — new feature
- `fix: correct Y` — bug fix
- `docs: improve Z` — documentation
- `chore: bump deps` — maintenance
## Pull request checklist
- [ ] Tests pass locally
- [ ] New behavior is documented (README / docs/)
- [ ] No secrets or large binaries committed
## Code of Conduct
By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
