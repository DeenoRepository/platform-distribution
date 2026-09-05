import { describe, it, expect } from 'vitest';
import path from 'node:path';
const { TopologyValidator } = require('./validate-topology.cjs');

describe('TopologyValidator', () => {
  const validator = new TopologyValidator();

  it('validates the actual production docker-compose.yml file successfully', () => {
    const composePath = path.join(__dirname, '../docker-compose.yml');
    const result = validator.validateFile(composePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('detects missing configuration parameters in invalid compose snippets', () => {
    const invalidCompose = `
version: '3.8'
services:
  app:
    image: node:20
`;
    const result = validator.validate(invalidCompose);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing container_name: ems-postgres');
    expect(result.errors).toContain('PostgreSQL max_connections must be set to at least 100 for 50 concurrent users');
    expect(result.errors).toContain('Missing container_name: ems-redis');
    expect(result.errors).toContain('Redis 7 must enable AOF persistence for reliable event streams');
    expect(result.errors).toContain('Missing container_name: ems-shell');
    expect(result.errors).toContain('Missing container_name: ems-nginx');
  });

  it('returns error when file does not exist', () => {
    const result = validator.validateFile('/non-existent/docker-compose.yml');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('File not found');
  });

  it('handles non-string or empty input safely', () => {
    const result = validator.validate(null as any);
    expect(result.valid).toBe(false);
  });
});
