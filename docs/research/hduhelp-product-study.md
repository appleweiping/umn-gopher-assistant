# HDUHelp product study and UMN adaptation

Status: source review completed 2026-07-22

Scope: public product history, public feature descriptions, public repositories,
and the 2024 campus-AI report. This is a product study, not a source-code
dependency or a claim of affiliation.

## Executive finding

HDUHelp is useful as a reference because it grew into a maintained campus
service layer. It did not win merely by showing a timetable. Its public history
shows a sequence of increasingly trusted jobs: answer frequent student queries,
organize a durable student team, integrate services owned by different campus
departments, deliver time-sensitive workflows, and finally expose capabilities
to both people and software clients.

The transferable idea for UMN Gopher Assistant is therefore a governed,
five-campus service platform. A collection of attractive but disconnected
pages would miss the central lesson.

## What the public evidence says

### 1. A narrow, high-frequency beginning

HDUHelp's [official history](https://about.hduhelp.com/detail/history/) dates the
trial launch to May 2013. The initial jobs were concrete and recurrent: class
schedule, running-status, weather, and empty-classroom queries. Grade lookup
followed in July. These functions reduce small but repeated pieces of friction;
they also create a reason to return every day.

The project became a formal student organization in September 2013. Its
published team description explicitly includes development, maintenance,
design, writing, operations, and other non-coding work. Later milestones include
a recruitment system, broader reporting workflows, and long-running leadership
cohorts. The important product detail is organizational continuity: data and
interfaces must still be maintained after the original developers graduate.

### 2. A unified entry point, not one feature

The public [feature description](https://about.hduhelp.com/detail/func/) groups
student work across several boundaries:

- daily academic and living queries, including schedule, grades, weather,
  campus-card balance, and residence utility balance;
- transactional or guided workflows such as new-student reporting, club
  recruitment, and leave requests;
- integrations with campus publishers and service owners for running,
  logistics, library borrowing, seat reservations, and co-curricular activity;
- time-sensitive notification, including recruitment and examination
  reminders;
- storage of student-facing artifacts associated with a workflow.

Some historical features are institution-specific and some concern a particular
period. They are evidence of an integration pattern, not a checklist that this
project should reproduce without UMN authorization.

### 3. Campus AI depends on maintained campus knowledge

HDU's [September 2024 report](https://www.hdu.edu.cn/2024/0918/c11550a270504/page.htm)
describes “Hang Xiaoyi,” an onboarding Q&A experience built by the HDUHelp
student group. The team collected academic, student-affairs, registrar, and
logistics material with campus departments, localized the knowledge, and added
technical constraints and security work around the general-purpose model. The
report says use exceeded 600 Q&A turns per day after launch.

That account supports three design requirements for this repository:

1. Campus answers need maintained, permission-aware source material.
2. A model response must remain subordinate to provenance, freshness, and an
   official verification path.
3. Knowledge operations and departmental review are product features, not
   invisible preparation for a chat screen.

### 4. The service surface extends beyond a phone UI

The current public [HDUHelp CLI](https://github.com/hduhelp/cli) describes a
device-authorization flow that grants a limited PAT and supports human queries,
automation, and AI-tool use. The public organization also contains the
[Neo Go SDK and OpenAPI contract](https://github.com/hduhelp/hduhelp-neo-sdk-go),
developer documentation, training repositories, and infrastructure-adjacent
projects. This indicates a platform mindset: a stable contract can serve a web
experience, command line, scripts, and agents.

The public repositories do not establish that HDUHelp's entire production
backend is open source. UMN Gopher Assistant therefore does not copy, vendor,
or claim to be built on a hidden or inferred HDUHelp core.

## Product mechanics behind the visible features

| Mechanic                     | Why it matters                                                                     | UMN implementation consequence                                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Frequent utility             | A useful answer today builds habit and reveals data-quality failures quickly.      | `Today` starts with source-labeled schedule, tasks, events, transport, dining, weather, library, and safety links.           |
| Cross-department integration | Campus services have different owners, terms, and failure modes.                   | Every source implements `CampusSourceAdapter` and carries license, cache, freshness, parser, hash, and campus metadata.      |
| Timely delivery              | Exams, onboarding, closures, and deadlines lose value when stale.                  | Notifications are emitted from governed events; stale and unavailable states remain visible and link to the official source. |
| Durable organization         | Student teams turn over while credentials, incidents, and source formats persist.  | Runbooks, RBAC, audit events, ownership, source-health views, and handover-friendly contracts are first-class deliverables.  |
| Shared platform contract     | The same capability can serve people, scripts, and agents without screen scraping. | REST/OpenAPI is the source for the SDK and CLI; MCP writes require preview, confirmation, scope, and idempotency.            |
| Curated campus AI            | Retrieval quality is constrained by knowledge maintenance, not only model choice.  | Answers cite evidence, disclose conflicts and staleness, and support useful retrieval even without a provider key.           |

## What must not be copied mechanically

UMN has five campuses, US privacy and accessibility obligations, distinct
identity systems, and source-specific terms. Consequently this project must not:

- collect a MyU, PeopleSoft, Google, or Canvas password or personal Canvas
  token;
- infer permission to cache a source merely because it is publicly reachable;
- present a schematic map as an authoritative accessible or emergency route;
- reproduce HDUHelp branding, content, private APIs, operational assumptions,
  or institution-specific approval flows;
- promise official UMN status before the written brand, SAML, data, and spatial
  approvals are reviewed;
- let a cloud model silently read the user's encrypted personal vault.

## Resulting UMN product thesis

UMN Gopher Assistant should provide one coherent service plane with three trust
levels:

1. Public, source-governed campus information works anonymously and fails to an
   official deep link when reuse is not authorized.
2. Account and community capabilities use least-privilege identity, moderation,
   retention, and auditable administration.
3. Private planning data remains client-side end-to-end encrypted; new-device
   authorization and recovery are cryptographic operations, not help-desk
   access to plaintext.

The 3D campus, realtime rooms, AI, community, SDK, CLI, and MCP surfaces are
valuable only when they preserve those levels. This is the standard used by the
repository's architecture decisions, contracts, tests, and release gates.

## 中文结论

杭电助手值得借鉴的不是某一个“查课表”页面，而是十余年形成的校园服务
运营方式：从高频刚需切入，由稳定的学生组织持续维护，与校内不同部门协作，
把查询、提醒、办事入口、内容运营和开发者接口整合为统一入口。2024 年的
“杭小易”进一步说明，校园 AI 的质量来自经过维护的校内知识与约束，而不是
给通用模型套一个聊天界面。

UMN 项目据此采用五校数据适配器、来源与许可治理、证据式 AI、个人数据
端到端加密、社区治理、数字校园、管理后台以及统一 OpenAPI/SDK/CLI/MCP。
由于学校体系、合规要求和授权边界不同，本项目只借鉴产品与组织方法，不复制
杭电助手品牌、私有接口或无法验证的生产实现。
