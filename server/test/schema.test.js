import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point } from '@turf/helpers';
import { createDatabase, getJournalMode } from '../src/db/database.js';
import { createPlaceService } from '../src/services/places.js';
import { makeTestContext } from '../test-support/helpers.js';

const EXPECTED_TABLES = [
  'USERS',
  'SESSIONS',
  'PLACES',
  'PLACE_HIERARCHY',
  'SETTINGS',
  'USER_VISITS',
  'USER_PLACE_RANK',
  'MEDIA',
  'KNOCKS',
  'MOMENTS',
  'MOMENT_PRESENCE',
  'MEMORIES',
  'MEMORY_MEDIA',
  'MEMORY_REACTIONS',
  'MEMORY_PARTICIPANTS',
];

test('SQLite enables WAL, installs the full schema, and seeds nested places', () => {
  const context = makeTestContext();
  const db = createDatabase(context.config);

  try {
    assert.equal(getJournalMode(db), 'wal');
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');

    const tables = db.prepare(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
    ).all().map((row) => row.name).sort();
    assert.deepEqual(tables, [...EXPECTED_TABLES].sort());

    for (const table of EXPECTED_TABLES) {
      const columns = db.pragma(`table_info('${table}')`);
      const seedColumn = columns.find((column) => column.name === 'IS_SEED');
      assert.ok(seedColumn, `${table} is missing IS_SEED`);
      assert.equal(seedColumn.notnull, 1, `${table}.IS_SEED must be NOT NULL`);
      assert.equal(String(seedColumn.dflt_value), '0', `${table}.IS_SEED must default to 0`);
    }

    const requiredIndexes = [
      {
        name: 'KNOCKS_PLACE_CREATED_AT_IDX',
        columns: [['PLACE_ID', 0], ['CREATED_AT', 0]],
      },
      {
        name: 'MOMENTS_PLACE_CREATED_AT_IDX',
        columns: [['PLACE_ID', 0], ['CREATED_AT', 0]],
      },
      {
        name: 'MEMORIES_PLACE_ENGRAVED_AT_IDX',
        columns: [['PLACE_ID', 0], ['ENGRAVED_AT', 1]],
      },
    ];
    for (const expected of requiredIndexes) {
      const columns = db.pragma(`index_xinfo('${expected.name}')`)
        .filter((column) => column.key === 1)
        .map((column) => [column.name, column.desc]);
      assert.deepEqual(columns, expected.columns, expected.name);
    }

    const placeRows = db.prepare(
      'SELECT ID, PARENT_PLACE_ID, GEOJSON, IS_SEED FROM PLACES ORDER BY ID',
    ).all();
    assert.equal(placeRows.length, 2);
    assert.ok(
      placeRows.every((row) => row.IS_SEED === 0),
      'structural places must survive future fake-seed wipes',
    );

    const technion = JSON.parse(placeRows.find((row) => row.ID === 'technion').GEOJSON);
    const faculty = JSON.parse(
      placeRows.find((row) => row.ID === 'faculty-data-decision-sciences').GEOJSON,
    );
    for (const [lng, lat] of faculty.coordinates[0]) {
      assert.equal(booleanPointInPolygon(point([lng, lat]), technion), true);
    }

    const places = createPlaceService(db);
    assert.equal(places.resolve(32.77421, 35.02361).id, 'faculty-data-decision-sciences');
    assert.equal(places.resolve(32.7805, 35.022).id, 'technion');
    assert.equal(places.resolve(0, 0), null);
    assert.deepEqual(
      places.getLayerStack('faculty-data-decision-sciences').map((place) => place.id),
      ['faculty-data-decision-sciences', 'technion'],
    );
  } finally {
    db.close();
    context.cleanup();
  }
});

test('the same database can be opened twice with WAL and foreign keys intact', () => {
  const context = makeTestContext();
  const first = createDatabase(context.config);
  const second = createDatabase(context.config);
  try {
    assert.equal(getJournalMode(first), 'wal');
    assert.equal(getJournalMode(second), 'wal');
    assert.equal(second.pragma('foreign_keys', { simple: true }), 1);
    assert.equal(fs.existsSync(context.config.databasePath), true);
  } finally {
    second.close();
    first.close();
    context.cleanup();
  }
});
