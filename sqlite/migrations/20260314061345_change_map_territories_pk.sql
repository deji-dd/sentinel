-- Migration: Change PRIMARY KEY of sentinel_map_territories
-- Description: Changes PK from (map_id, territory_id) to (map_id, territory_id, label_id) to allow a territory to be assigned to multiple labels.

PRAGMA foreign_keys=OFF;

CREATE TABLE sentinel_map_territories_new (
    map_id TEXT NOT NULL,
    territory_id TEXT NOT NULL,
    label_id TEXT NOT NULL,
    PRIMARY KEY (map_id, territory_id, label_id),
    FOREIGN KEY (map_id) REFERENCES sentinel_maps(id) ON DELETE CASCADE,
    FOREIGN KEY (label_id) REFERENCES sentinel_map_labels(id) ON DELETE CASCADE
);

INSERT INTO sentinel_map_territories_new (map_id, territory_id, label_id)
SELECT map_id, territory_id, label_id FROM sentinel_map_territories;

DROP TABLE sentinel_map_territories;

ALTER TABLE sentinel_map_territories_new RENAME TO sentinel_map_territories;

CREATE INDEX IF NOT EXISTS idx_map_territories_map_id ON sentinel_map_territories(map_id);

PRAGMA foreign_keys=ON;
