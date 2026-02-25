---
oat_status: in_progress
oat_ready_for: null
oat_blockers: []
oat_last_updated: YYYY-MM-DD
oat_generated: false
oat_template: true
oat_template_name: design
---

# Design: {Project Name}

## Overview

{2-3 paragraph summary of the technical approach, including key architectural decisions and rationale}

## Architecture

### System Context

{How this fits into the broader system architecture}

**Key Components:**
- **{Component 1}:** {Purpose and responsibilities}
- **{Component 2}:** {Purpose and responsibilities}

### Component Diagram

```
{ASCII diagram or description of component relationships}
```

### Data Flow

{Description of how data moves through the system}

```
{Sequence diagram or step-by-step flow}
```

## Component Design

### {Component Name}

**Purpose:** {What this component does}

**Responsibilities:**
- {Responsibility 1}
- {Responsibility 2}

**Interfaces:**
```typescript
// Key interfaces, classes, or function signatures
```

**Dependencies:**
- {Internal dependency 1}
- {External dependency 1}

**Design Decisions:**
- {Decision 1 and rationale}

## Data Models

### {Model Name}

**Purpose:** {What this represents}

**Schema:**
```typescript
interface ModelName {
  // Field definitions with types
}
```

**Validation Rules:**
- {Rule 1}
- {Rule 2}

**Storage:**
- **Location:** {Database, file system, memory}
- **Persistence:** {How/when data is persisted}

## API Design

### {Endpoint/Interface Name}

**Method:** GET / POST / PUT / DELETE
**Path:** `/api/v1/{resource}`

**Request:**
```typescript
interface Request {
  // Request schema
}
```

**Response:**
```typescript
interface Response {
  // Response schema
}
```

**Error Handling:**
- {Error code}: {Description}

**Authorization:** {Auth requirements}

## Security Considerations

### Authentication

{How users/services authenticate}

### Authorization

{How permissions are enforced}

### Data Protection

- **Encryption:** {At rest, in transit}
- **PII Handling:** {How sensitive data is protected}
- **Input Validation:** {Where and how inputs are validated}

### Threat Mitigation

- **{Threat 1}:** {Mitigation strategy}
- **{Threat 2}:** {Mitigation strategy}

## Performance Considerations

### Scalability

{How the design scales with load}

### Caching

- **Layer:** {Where caching occurs}
- **Strategy:** {Cache invalidation approach}
- **TTL:** {Time-to-live values}

### Database Optimization

- **Indexes:** {Key indexes to create}
- **Query Optimization:** {Query patterns to optimize}

### Resource Limits

- **Memory:** {Expected usage}
- **CPU:** {Expected usage}
- **Network:** {Expected bandwidth}

## Error Handling

### Error Categories

- **User Errors:** {How handled}
- **System Errors:** {How handled}
- **External Service Errors:** {How handled}

### Retry Logic

{When and how retries are performed}

### Logging

- **Info:** {What to log at info level}
- **Warn:** {What to log at warn level}
- **Error:** {What to log at error level}

## Testing Strategy

### Requirement-to-Test Mapping

{Maps spec requirements to test levels and key scenarios — ensures every requirement has a verification plan}

| ID | Verification | Key Scenarios |
|----|--------------|---------------|
| FR1 | {unit/integration/e2e/manual/perf} | {Scenario 1}, {Scenario 2} |
| FR2 | {unit/integration/e2e/manual/perf} | {Scenario 1} |
| NFR1 | {unit/integration/e2e/manual/perf} | {Scenario 1} |

**Notes:**
- Pull ID from spec.md Requirement Index
- Copy the **method** (left side of `method: pointer`) into Verification
- Use the **pointer** (right side) to seed Key Scenarios, then expand based on design
- Multiple test levels are valid (e.g., "unit + integration")

### Unit Tests

- **Scope:** {What gets unit tested}
- **Coverage Target:** {N}%
- **Key Test Cases:**
  - {Test case 1}
  - {Test case 2}

### Integration Tests

- **Scope:** {What gets integration tested}
- **Test Environment:** {How environment is set up}
- **Key Test Cases:**
  - {Test case 1}
  - {Test case 2}

### End-to-End Tests

- **Scope:** {What gets E2E tested}
- **Test Scenarios:**
  - {Scenario 1}
  - {Scenario 2}

## Deployment Strategy

### Build Process

{How the application is built}

### Deployment Steps

1. {Step 1}
2. {Step 2}

### Rollback Plan

{How to rollback if deployment fails}

### Configuration

- **Environment Variables:** {List with descriptions}
- **Feature Flags:** {Any feature flags needed}

### Monitoring

- **Metrics:** {Key metrics to track}
- **Alerts:** {Alert conditions}
- **Dashboards:** {What to monitor}

## Migration Plan

{If this involves database migrations, data migrations, or breaking changes}

### Migration Steps

1. {Step 1}
2. {Step 2}

### Rollback Strategy

{How to rollback migrations}

### Data Validation

{How to verify migration success}

## Open Questions

- **{Question Category}:** {Question needing resolution}
- **{Question Category}:** {Question needing resolution}

## Implementation Phases

### Phase 1: {Phase Name}

**Goal:** {What this phase achieves}

**Tasks:**
- {Task 1}
- {Task 2}

**Verification:** {How to verify phase completion}

### Phase 2: {Phase Name}

{Similar structure}

## Dependencies

### External Dependencies

- **{Service/Library}:** {Why needed, version constraints}

### Internal Dependencies

- **{Component/Service}:** {Why needed, coupling points}

### Development Dependencies

- **{Tool}:** {Why needed}

## Risks and Mitigation

- **{Risk 1}:** {Probability: Low/Medium/High} | {Impact: Low/Medium/High}
  - **Mitigation:** {How to reduce risk}
  - **Contingency:** {What to do if risk occurs}

## References

- Specification: `spec.md`
- Knowledge Base: `.oat/repo/knowledge/project-index.md`
- Architecture Docs: `.oat/repo/knowledge/architecture.md`
- Conventions: `.oat/repo/knowledge/conventions.md`
