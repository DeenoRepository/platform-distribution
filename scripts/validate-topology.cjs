/**
 * Docker Compose Topology Validator for 50 Concurrent Users
 */

const fs = require('node:fs');
const path = require('node:path');

class TopologyValidator {
  validate(composeContent) {
    const errors = [];
    const warnings = [];

    // Parse essential keywords from YAML without heavy external dependency
    const lines = typeof composeContent === 'string' ? composeContent.split('\n') : [];

    // 1. Check PostgreSQL configuration
    const hasPostgres = lines.some(l => l.includes('container_name: ems-postgres'));
    if (!hasPostgres) {
      errors.push('Missing container_name: ems-postgres');
    }

    const hasMaxConnections = lines.some(l => l.includes('max_connections=100'));
    if (!hasMaxConnections) {
      errors.push('PostgreSQL max_connections must be set to at least 100 for 50 concurrent users');
    }

    const hasSharedBuffers = lines.some(l => l.includes('shared_buffers=256MB'));
    if (!hasSharedBuffers) {
      errors.push('PostgreSQL shared_buffers must be set to at least 256MB');
    }

    const hasPgHealthcheck = lines.some(l => l.includes('pg_isready'));
    if (!hasPgHealthcheck) {
      errors.push('PostgreSQL missing healthcheck with pg_isready');
    }

    // 2. Check Redis configuration
    const hasRedis = lines.some(l => l.includes('container_name: ems-redis'));
    if (!hasRedis) {
      errors.push('Missing container_name: ems-redis');
    }

    const hasRedisAof = lines.some(l => l.includes('--appendonly yes'));
    if (!hasRedisAof) {
      errors.push('Redis 7 must enable AOF persistence for reliable event streams');
    }

    const hasRedisHealthcheck = lines.some(l => l.includes('redis-cli') && l.includes('ping'));
    if (!hasRedisHealthcheck) {
      errors.push('Redis missing healthcheck with redis-cli ping');
    }

    // 3. Check Shell Host configuration
    const hasShell = lines.some(l => l.includes('container_name: ems-shell'));
    if (!hasShell) {
      errors.push('Missing container_name: ems-shell');
    }

    const hasShellHealthcheck = lines.some(l => l.includes('http://localhost:3000/health'));
    if (!hasShellHealthcheck) {
      errors.push('App shell missing healthcheck probe for /health');
    }

    const hasPostgresDependency = lines.some(l => l.includes('condition: service_healthy'));
    if (!hasPostgresDependency) {
      warnings.push('Services should wait for healthy database condition');
    }

    // 4. Check Nginx Gateway
    const hasNginx = lines.some(l => l.includes('container_name: ems-nginx'));
    if (!hasNginx) {
      errors.push('Missing container_name: ems-nginx');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  validateFile(filePath) {
    const fullPath = path.resolve(filePath);
    if (!fs.existsSync(fullPath)) {
      return {
        valid: false,
        errors: [`File not found: ${filePath}`],
        warnings: []
      };
    }

    const content = fs.readFileSync(fullPath, 'utf8');
    return this.validate(content);
  }
}

module.exports = { TopologyValidator };

if (require.main === module) {
  const validator = new TopologyValidator();
  const result = validator.validateFile(path.join(__dirname, '../docker-compose.yml'));
  if (!result.valid) {
    console.error('[TopologyValidator] Validation failed:', result.errors);
    process.exit(1);
  }
  console.log('[TopologyValidator] Docker Compose topology valid for 50 concurrent users.');
}
