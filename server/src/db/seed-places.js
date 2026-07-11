import fs from 'node:fs';

const placeFiles = [
  new URL('../data/places/technion.geojson', import.meta.url),
  new URL('../data/places/faculty-data-decision-sciences.geojson', import.meta.url),
];

function readFeature(url) {
  const feature = JSON.parse(fs.readFileSync(url, 'utf8'));
  if (feature.type !== 'Feature' || feature.geometry?.type !== 'Polygon') {
    throw new Error(`${url.pathname} must contain one GeoJSON Polygon Feature`);
  }
  return feature;
}

export function seedPlaces(db) {
  const insertPlace = db.prepare(
    `INSERT INTO PLACES (ID, NAME, SLUG, PARENT_PLACE_ID, GEOJSON, IS_SEED)
     VALUES (@id, @name, @slug, @parentPlaceId, @geojson, 0)
     ON CONFLICT(ID) DO UPDATE SET
       NAME = excluded.NAME,
       SLUG = excluded.SLUG,
       PARENT_PLACE_ID = excluded.PARENT_PLACE_ID,
       GEOJSON = excluded.GEOJSON,
       IS_SEED = 0`,
  );
  const insertHierarchy = db.prepare(
    `INSERT INTO PLACE_HIERARCHY
       (ANCESTOR_PLACE_ID, DESCENDANT_PLACE_ID, DEPTH, IS_SEED)
     VALUES (?, ?, ?, 0)
     ON CONFLICT(ANCESTOR_PLACE_ID, DESCENDANT_PLACE_ID) DO UPDATE SET
       DEPTH = excluded.DEPTH,
       IS_SEED = 0`,
  );

  // These two required map layers are structural bootstrap data, not removable
  // fake content. Keeping IS_SEED=0 prevents a later seed wipe from cascading
  // into real visits and student content that reference the places.
  db.transaction(() => {
    for (const url of placeFiles) {
      const feature = readFeature(url);
      insertPlace.run({
        id: feature.properties.id,
        name: feature.properties.name,
        slug: feature.properties.slug,
        parentPlaceId: feature.properties.parentPlaceId ?? null,
        geojson: JSON.stringify(feature.geometry),
      });
    }

    insertHierarchy.run('technion', 'technion', 0);
    insertHierarchy.run(
      'faculty-data-decision-sciences',
      'faculty-data-decision-sciences',
      0,
    );
    insertHierarchy.run('technion', 'faculty-data-decision-sciences', 1);
  })();
}
