# ReMarkt Grading App

Webapp voor laptop-/monitorgrading, batchimport, medewerkersbeheer, inzichten en DYMO-labels.

Bedrijfsrepository voor de overdracht: <https://github.com/Terabyte-BV/Grade-app>.
Code, actieve afbeeldingen, tests, SQL-schema's en onderhoudsscripts staan in Git.
Productiegegevens, databasewachtwoorden, sessiesleutels en herstelkopieën worden apart overgedragen.

## Begin hier

- [Overdracht en stappenplan voor de eigen server](docs/SERVER-OVERDRACHT.md)
- [PostgreSQL-recordopslag en herstel](docs/RECORD-STORAGE.md)
- [Releasecontrole](docs/LIVE-RUNBOOK.md)
- [Recente reparaties en verificatie](docs/grading-result-labels-verification.md)

## Architectuur

`index.html` en `assets/` vormen een browserapp zonder frontend-buildstap. De scriptvolgorde in `index.html` is bepalend.

De Node-handlers `api/session.mjs`, `api/demo-state.mjs`, `api/stats.mjs` en `api/health.mjs` draaien momenteel op Vercel. De actuele opslag is PostgreSQL, recordformaat 3. De huidige databaseverbinding gebruikt de HTTP-interface van `@neondatabase/serverless`.

Alleen de bestanden op een webserver zetten is onvoldoende: een eigen server heeft ook een HTTP-runtime voor de API-handlers nodig. Voor een eigen PostgreSQL is daarnaast een geschikte database-adapter nodig; alleen de connection string vervangen is geen geteste migratie.

## Ontwikkelen en testen

Gebruik voor de overdracht Node.js 24, overeenkomstig de gecontroleerde Vercel-runtime.

```sh
npm ci
npm test
npm run check
```

De laatste functionele release vóór deze documentatie is `5ddf82c`, build `20261029-workstation-repair-v4`: 395 tests geslaagd.

Een geïsoleerde demonstratie met synthetische gegevens en dezelfde API-handlers:

```sh
node tools/record-qa-server.mjs
```

Deze testserver luistert op `http://127.0.0.1:8094`, toont zijn testaccount in de terminal en gebruikt uitsluitend een tijdelijke in-memory database. Gegevens verdwijnen na stoppen. Dit is geen productie-installatie.

**Let op:** `npm start` en `npm run dev` starten momenteel de oude lokale JSON-bestandsserver. Gebruik die niet als vervanging voor de actieve productiedatabase. Er is nog geen geteste productie-startopdracht voor een eigen server.

## Configuratie en beheer

[`.env.example`](.env.example) bevat uitsluitend voorbeeldvelden. De echte waarden worden door de bevoegde beheerder beveiligd overgedragen. Een GitHub-overdracht verplaatst de Vercel-environment en database niet.

Initialiseer geen lege administratie wanneer laden mislukt. Behoud bij migratie recordidentiteiten, revisies, verwijdermarkeringen, wachtwoordhashes en mutatiebewijzen. Verzamel ook nog niet gesynchroniseerd browserwerk vóór een wijziging van database of webadres.
