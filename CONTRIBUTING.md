# Contributing to ClawZ

Thank you for your interest in contributing to ClawZ! This document provides guidelines for contributing.

## Development Setup

### Prerequisites

- **Node.js** 22.22.0 (see `.nvmrc`)
- **Rust** >= 1.77.2
- **pnpm** >= 10.x
- **Tauri CLI**: `cargo install tauri-cli`

### macOS Additional Requirements

- Xcode Command Line Tools: `xcode-select --install`

### Linux Additional Requirements

```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev \
  librsvg2-dev patchelf libssl-dev libgtk-3-dev \
  libjavascriptcoregtk-4.1-dev libsoup-3.0-dev
```

### Getting Started

```bash
git clone https://github.com/clawz-ai/ClawZ.git
cd ClawZ
pnpm install --frozen-lockfile
pnpm tauri dev
```

### Project Structure

```
ClawZ/
├── src/                          # Frontend (React + TypeScript)
│   ├── pages/
│   │   ├── onboarding/           # Setup wizard steps
│   │   ├── Dashboard.tsx         # Main dashboard
│   │   ├── ScenarioWorkshop.tsx  # Scenario templates & persona editor
│   │   ├── AgentManagement.tsx   # Agent CRUD, channel binding
│   │   ├── ModelManagement.tsx   # Model providers & configuration
│   │   ├── ChannelManagement.tsx # Channel & multi-account management
│   │   ├── LogCenter.tsx         # Log viewer
│   │   ├── CostDashboard.tsx     # Token usage & cost tracking
│   │   ├── Settings.tsx          # App settings (7 tabs)
│   │   └── ...
│   ├── components/               # Reusable UI components
│   │   ├── layout/               # AppShell, Sidebar, Header
│   │   └── ui/                   # Button, Input, Card, Drawer, etc.
│   ├── lib/                      # Business logic, IPC wrappers, i18n
│   │   ├── tauri.ts              # All Tauri invoke() wrappers (typed)
│   │   ├── i18n/                 # Translations (zh-CN, en-US)
│   │   ├── channels.ts           # Channel definitions
│   │   ├── providers.ts          # Model provider definitions
│   │   └── ...
│   ├── stores/                   # Zustand state stores
│   ├── data/scenarios/           # Built-in scenario JSON files
│   └── types/                    # TypeScript type definitions
├── src-tauri/                    # Backend (Rust)
│   ├── src/
│   │   ├── commands/             # Tauri IPC command handlers
│   │   │   ├── cli.rs            # CLI executor (oc_run, shell_escape)
│   │   │   ├── model.rs          # Model provider & OAuth flows
│   │   │   ├── channel.rs        # Channel configuration
│   │   │   ├── gateway.rs        # Gateway lifecycle management
│   │   │   ├── agents.rs         # Agent CRUD & binding
│   │   │   ├── scenario.rs       # Scenario deploy & skills
│   │   │   ├── installer.rs      # OpenClaw CLI installation
│   │   │   └── ...
│   │   └── lib.rs                # Tauri app builder & plugin registration
│   ├── Cargo.toml
│   └── tauri.conf.json           # Tauri app configuration
├── scripts/                      # Build helper scripts
├── docs/                         # Design documents
├── package.json
├── vite.config.ts
└── tsconfig.json
```

### Running Tests

```bash
# Frontend tests
pnpm test

# With coverage
pnpm test:coverage

# Rust check + lint
cd src-tauri
cargo check --locked
cargo clippy --locked -- -D warnings
```

## Submitting Changes

1. Fork the repository
2. Create a task branch: `git checkout -b feat/your-feature` or `git checkout -b fix/your-fix`
3. Branch names for new work must start with `feat/` or `fix/` only. Do not create new branches with prefixes like `chore/`, `docs/`, `refactor/`, or any other prefix.
4. Make your changes
5. Ensure tests pass: `pnpm test:coverage` and `cargo clippy --locked -- -D warnings`
6. Commit with a descriptive message
7. Push and open a Pull Request

### Commit Messages

Use conventional commit format:

- `feat:` new feature
- `fix:` bug fix
- `chore:` maintenance
- `docs:` documentation
- `refactor:` code restructuring

### Code Style

- **TypeScript**: Follow existing patterns, use `useT()` for all user-facing strings
- **Rust**: Run `cargo fmt` and `cargo clippy` before committing
- **i18n**: Always update both `zh-CN.ts` and `en-US.ts` when adding text

## Reporting Issues

- Use [GitHub Issues](https://github.com/clawz-ai/ClawZ/issues)
- Include OS version, ClawZ version, and steps to reproduce
- Attach relevant logs from the Log Center page

## Code of Conduct

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before participating.
