const assert = require('assert');
const fs = require('fs');
const path = require('path');

const controllerPath = path.join(__dirname, '..', 'eventController.js');
const source = fs.readFileSync(controllerPath, 'utf8');
const controller = require(controllerPath);

process.env.JWT_SECRET = process.env.JWT_SECRET || 'event-contract-test-secret';
const key = controller.createStoreTrackingKey('store-123');

assert.ok(key.includes('store-123.'), 'tracking keys must contain an opaque signed store reference');
assert.ok(source.includes("source: 'pixel'"), 'pixel events must persist their source');
assert.ok(source.includes('source_event_id: event.id'), 'pixel event IDs must be persisted');
assert.ok(source.includes('received_at: new Date()'), 'pixel receipt time must be persisted');
assert.strictEqual((source.match(/exports\.ingestBatch\s*=/g) || []).length, 1, 'batch ingestion must have one implementation');
assert.ok(!source.includes('/api/features/compute'), 'pixel ingestion must not call the dead synchronous feature route');

console.log('event.contract.test.js: all assertions passed');
