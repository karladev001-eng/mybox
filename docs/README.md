# Documentation

This directory records durable architecture and product decisions.

- `app-framework.md` defines the app contract, state ownership, integration flow,
  agent access, and extension points.
- `app-authoring.md` is the self-contained, practical guide for building or
  changing one App: directory layout, manifest/operation cheat sheet,
  registration steps, and a pre-handoff checklist. Read this instead of the
  rest of the repository when the task is scoped to one App.
- `knowledge-app-spec.md` defines the accepted product, domain, storage,
  authorization, interchange, and delivery requirements for the Knowledge App.
- `system-overview.md` provides the project-wide architecture diagram and marks
  current versus planned paths.
- `adr/README.md` is the decision-record index.

Read the framework document for implementation work involving apps, storage,
flows, events, or agents. Read only the ADRs linked from the relevant section or
needed to understand a decision being changed.
