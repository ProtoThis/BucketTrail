
# BucketTrail

Small self-hosted travel bucket list app.

## Run locally with Docker

```bash
docker compose up --build
```

Open: http://localhost:8000

## Persistence

Data is stored in SQLite at:

```text
./data/buckettrail.db
```

Back up this file to back up your places and trips.

## API

```text
GET /api/health
GET /api/state
PUT /api/state
```

The frontend saves the full app state to `/api/state`. It still keeps a browser localStorage fallback/cache.

## Notes

The map/address search still uses Leaflet + OpenStreetMap/Nominatim from the browser.
For private/home use this is fine. If you expose this publicly, add authentication first.
