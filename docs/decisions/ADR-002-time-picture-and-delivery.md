# ADR-002: Preserve time domains and freeze delivery inputs

## Status

Accepted for the research specification; empirical sync/export proof is pending.

## Date

16 October 2026.

## Context

Sample editing, fractional frame rates, picture changes and stem delivery can disagree if time is stored only as UI pixels or rounded decimal seconds. Render jobs can also drift if they observe edits while running.

## Decision

Use integer source/project samples for audio and exact rational picture frame rates with retained frame identity. Use half-open ranges and one declared conversion rule. Freeze each render's editing-state revision/hash, dependency set, picture revision, range, selected signal paths and technical policies. Record omissions and actual outputs in a terminal manifest.

## Alternatives considered

- Floating-point seconds everywhere: convenient, but makes source boundaries and repeated conversions harder to audit.
- Frame-only edits: insufficient for audio trims and crossfades.
- Export the current visible/solo state: quick but not a dependable delivery contract.

## Consequences

Frame/sample conversions need focused boundary tests. Initial unsupported rates/formats are rejected explicitly. Deterministic dry-stem checks and actual picture sync are separate gates. Shared nonlinear master processing requires a documented stem recombination policy.
