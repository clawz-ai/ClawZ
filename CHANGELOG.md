# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [0.1.2] - 2026-03-11

### Fixed

- Re-upload stapled DMG to release after successful notarization
- Increased notarization timeout to 2 hours for slow Apple service
- Use async submit + poll pattern for better notarization reliability

## [0.1.1] - 2026-03-11

### Fixed

- Separated Apple notarization from build step with timeout control and retry
- Added `continue-on-error` for notarization to prevent build failure on Apple service delays
- Updated OpenClaw links from openclaw.io to openclaw.ai

## [0.1.0] - 2026-03-10

### Added

- Initial open-source release
- Dashboard with gateway status overview
- Scenario Workshop with built-in AI agent templates
- Agent management (create, delete, configure, bind channels)
- Model management with multi-provider support (OpenAI, Anthropic, DeepSeek, etc.)
- Channel management with multi-account support (Telegram, Discord, Slack, etc.)
- Onboarding wizard (5-step guided setup)
- Cost dashboard with token usage tracking
- Log center for gateway and application logs
- Settings page (advanced config, security, backup/restore, i18n)
- Multi-agent scenario deployment
- Cron job management for scheduled tasks
- macOS and Linux platform support
- Bilingual UI (Chinese / English)
