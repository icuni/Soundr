# ADR-001: Independent project data and shared commands

## Status

Accepted for the research specification; implementation and runtime validation are pending.

## Date

16 October 2026.

## Context

Soundr must preserve sources, support GUI and MCP edits, connect story identities and produce predictable delivery. The reference studies show useful separations among media, arrangements, routing, processing and control surfaces.

## Decision

Keep an independent, versioned Soundr logical model. Represent immutable sources and editable clips separately. Route every UI/MCP mutation through one validated atomic command service with revision checks and persisted idempotency. Keep story references and picture revision in the first schema.

## Alternatives considered

- UI component state as the project: fast to mock up, but creates a second headless/MCP implementation and fragile persistence.
- Adopt a vendor's private session format as canonical: creates compatibility/licensing dependence without evidence of complete preservation.
- Fork Ardour immediately: inspectable engine, but a major code/licence/product commitment before the workflow is proven.

## Consequences

The core is testable without a UI. Saving and exporting require explicit dependency identity. Each new command must define undo, validation and revision semantics. This decision does not select a programming language or audio library.
