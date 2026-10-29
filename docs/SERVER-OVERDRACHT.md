# Overdracht naar Terabyte-BV en eigen server

Opgesteld op 29 oktober 2026. Uitvoerplan voor de developer; de server- en databasemigratie zijn hiermee nog niet uitgevoerd.

## Huidige situatie

| Onderdeel | Vastgesteld |
| --- | --- |
| Oude repository | `TimBeek/Grade-app` |
| Bedrijfsrepository voor de overdracht | `Terabyte-BV/Grade-app`, branch `main` |
| Laatste functionele reparatie | `5ddf82c`, build `20261029-workstation-repair-v4` |
| Live app | `https://grade-app-three.vercel.app/` |
| Hosting | Statische browserapp en vier Node-API-handlers op Vercel, Frankfurt |
| Database-interface | PostgreSQL via de Neon HTTP-driver, recordformaat 3 |
| Read-only productiecontrole | Directory antwoordt 200, `serverAuth=true`, `storageFormat=3` |
| Browseropslag | IndexedDB-herstelkopie/wachtrij en aanvullende localStorage-cache |
| Testbaseline | 395 tests geslaagd vóór deze documentatie |

## Uitgevoerde overdracht en openstaande koppeling

- GitHub-transfer naar `Terabyte-BV/Grade-app` afgerond. Repository-ID `1281083836` is gelijk gebleven; dit is dezelfde repository met bestaande geschiedenis. De oude TimBeek-URL verwijst door.
- Overdrachtsdocumentatie op `main` gepubliceerd. Lokale `origin` en de upstream van `main` wijzen nu naar de bedrijfsrepository. De eerdere remote naar het andere project Ingangscontrole is alleen lokaal hernoemd naar `ingangscontrole`; die andere repository is niet gewijzigd.
- De bestaande Vercel-productie met build `20261029-workstation-repair-v4` is na de transfer via het vaste adres gecontroleerd: HTTP 200. Database en server zijn nog niet verhuisd.
- **Openstaand:** Vercel weigert de nieuwe Git-koppeling. De reconnectpoging heeft geen actieve Git-link op het bestaande Vercel-project achtergelaten; de reeds gebouwde live deployment blijft beschikbaar. Automatische updates vanuit de nieuwe repository zijn dus nog niet operationeel.
- Laat een bevoegde organisatiebeheerder de toegang/installatie van de Vercel GitHub App voor `Terabyte-BV/Grade-app` controleren en vervolgens het bestaande project `re-markt/grade-app` onder Settings → Git koppelen. Maak hiervoor geen lege vervangende database of app aan. Controleer daarna een deployment voor de bedoelde commit. Deze toegangsactie is niet afgerond binnen de overdracht.

De GitHub-transfer moet de bestaande repository en geschiedenis behouden. De repository was openbaar; deze opdracht wijzigt de zichtbaarheid niet. Wel in Git: code, actieve beelden, vendorbestanden, tests, schema's en scripts. Niet in Git: database-inhoud, medewerkers-/batchherstelbestanden, browserprofielen, echte `.env`-bestanden, privésleutels en back-ups. Die worden afzonderlijk beveiligd overgedragen.

## Hoe zit het met de database?

Upstash/Redis is een historische opslagroute. De recoverycode is nog aanwezig, maar de huidige productie gebruikt PostgreSQL-recordopslag met `REMARKT_STORAGE_FORMAT=3`. Een GitHub-transfer verhuist die database niet mee.

Laat de beheerder de exacte actieve host, het project, de branch en databasenaam vaststellen uit de effectieve productieconfiguratie. Oudere Neon- en Redis-projecten mogen niet worden verward met de huidige werkdatabase. De URL wordt gekozen in deze volgorde:

1. `REMARKT_DATABASE_URL` — heeft voorrang, ook als `DATABASE_URL` is gevuld.
2. `DATABASE_URL`.
3. `POSTGRES_URL`.

Vraag dus niet uitsluitend naar `DATABASE_URL`: een herstel-override kan de werkelijke bron bepalen. Credentials worden via een wachtwoordkluis overgedragen, niet via Git, issues of openbare loguitvoer.

| Tabel | Te behouden inhoud |
| --- | --- |
| `remarkt_workspaces` | Workspace-identiteit en globale revisie |
| `remarkt_records` | Accounts, batches, apparaten, beoordelingen, labels, audits en verwijdermarkeringen; volledige payload en compacte summary |
| `remarkt_mutations` | Mutatiebewijzen voor idempotente herhaling na verbindingsverlies |
| `remarkt_rate_limits` | Tijdelijke account-/API-limieten |
| `remarkt_backup_health` | Gecontroleerde back-upstatus en tweede kopie |

`migrations/003-record-storage.sql` bevat het recordschema en de transactionele functie `remarkt_commit_records`. `005-backup-monitor.sql` vult back-updiagnostiek aan. `004-cutover-guard.sql` beschermt oudere opslag tegen oude schrijvers; verwijder oude tabellen/gates niet als ongecontroleerde opruiming.

Historische aantallen en quota-statussen in andere documenten zijn gedateerde waarnemingen. Controleer de huidige administratie bij export. Een accounts-only JSON bevat geen volledige batches of beoordelingshistorie; browserexports bevatten bewust geen serverwachtwoordhashes.

## Stappenplan voor de developer

### 1. Repository en toegang

```sh
git clone https://github.com/Terabyte-BV/Grade-app.git
cd Grade-app
npm ci
npm test
npm run check
```

Leg de uit te rollen commit vast. Controleer developmentteamrechten en toegang van de Vercel GitHub App na de transfer. Een lopende deployment bewijst niet dat toekomstige Git-deploys nog werken. Laat de bestaande live app beschikbaar totdat de nieuwe omgeving is goedgekeurd.

### 2. Server en databasekeuze vastleggen

Leg vast: server-OS, Node-runtime, reverse proxy, HTTPS-domein, PostgreSQL-versie, databasebeheerder, opslag en back-uplocaties. Begin met Node 24, dezelfde major als de huidige productie. Beheer geheimen buiten repository/documentroot en zorg voor procesbewaking en automatisch starten na reboot.

Variant A: eigen appserver, bestaande database tijdelijk behouden. Hiermee kan hosting afzonderlijk worden getest; bestaande providerlimieten blijven gelden.

Variant B: eigen appserver én eigen PostgreSQL. Hiervoor zijn een database-adapter, gecontroleerde datakopie en back-upbeheer nodig. Dit vermijdt de betreffende providerquota, maar eigen infrastructuur blijft capaciteit en beheer vragen.

De huidige adapter gebruikt `neon(url)` en HTTP, geen gewone TCP-pool. Voor eigen PostgreSQL: kies bijvoorbeeld `pg` en behoud parametergebonden queries en transactiegaranties. Alleen een andere URL invullen is onvoldoende. Deze adapterwijziging is nog niet geïmplementeerd/getest.

### 3. Productie-HTTP-runtime maken

Behoud de routes en bestaande queryparameters:

- `/api/session`: login, sessieverificatie, eerste wachtwoordwijziging en manageracties.
- `/api/demo-state`: directory, metadata, work-snapshot, delta's, trace, collectiepagina's en recordmutaties; inclusief gzip en `work=1&raw=1`.
- `/api/stats`: managercijfers en gefilterde inzichten.
- `/api/health`: beveiligde database-/back-upcontrole. Een anonieme 401 is geen uitval.

De handlers verwachten een Node-request en response met `setHeader`, `status(...).json(...)`. Implementeer die adapter in een Node-server/framework. Behoud de ruwe requeststream of compatibele JSON-parsing, de 4 MiB bodycontrole uit `api/_lib/http.mjs` en passende proxy-bodylimieten. Laat 401, 403, 409, 429 en 503 intact.

Serveer publiek alleen de bedoelde HTML-shell en assets. Zet niet de hele checkout of back-upmap onder een onbeperkte documentroot. Behoud API `no-store`, hercontrole voor de HTML-shell en versieparameters op gewijzigde scripts/beelden.

**Niet gebruiken voor productie:** `npm start` start de legacy JSON-bestandsserver. `tools/record-qa-server.mjs` toont de echte handleradapter, maar heeft synthetische accounts, QA-routes en een tijdelijke in-memory database. Maak een aparte productie-entrypoint.

### 4. Database-adapter en configuratie

Pas `api/_lib/postgres-state.mjs` én onderhoudsscripts met eigen `neon(...)`-verbindingen aan. Ook `scripts/backup-record-storage.mjs` moet de gekozen database kunnen bereiken.

Behoud of vervang gecontroleerd de `sql` tagged templates, `sql.query(...)` en `sql.transaction(...)`. Transacties moeten één verbinding gebruiken, met bedoelde isolatie, rollback en gegarandeerde vrijgave. Behoud recordconflicten, receipt-replay en gelijktijdige writes van verschillende medewerkers.

| Configuratie | Overdrachtsregel |
| --- | --- |
| Effectieve database-URL | Alleen backend; controleer de overridevolgorde hierboven |
| `REMARKT_STORAGE_FORMAT` | `3` voor de bestaande recordadministratie |
| `REMARKT_WORKSPACE_ID` | Exact dezelfde identiteit bij inhoudelijke verhuizing |
| `REMARKT_SESSION_SECRET` | Beveiligd overdragen of bewust roteren; roteren maakt tokens ongeldig |
| `REMARKT_METRICS` | Optioneel `1`, uitsluitend duur/grootte/foutcodes |
| Back-upconfiguratie | Apart: verbinding, externe map, tweede kopie en AES-sleutel |

Behoud wachtwoordhashes. Maak medewerkers niet opnieuw aan om een leeg lijkende omgeving te herstellen. Gebruik passende afzonderlijke runtime-/migratierechten.

### 5. Export en proefherstel

Maak een gecontroleerde PostgreSQL-export met schema, functies en data via een directe verbinding. Gebruik een bij de bron passende `pg_dump`-versie. Herstel eerst naar een afzonderlijke test-/doeldatabase. De bestaande versleutelde record-back-upketen kan aanvullend worden gebruikt als de volledige keten en sleutel beschikbaar zijn. Bewaar exports buiten GitHub.

Vergelijk accounts, batches, apparaten, volledige beoordelingen, labels, verwijdermarkeringen, workspace/revisies, mutatiebewijzen en recordinhoud. Alleen hetzelfde aantal rijen is onvoldoende. Controleer ook eerste-loginaccounts en oudere historie.

Voer `migrate:kv`, `seed:postgres`, `migrate:records` of oude restorecommando's niet blind uit op een bestaande v3-administratie: het zijn specifieke legacy-/cutovertools, geen generieke serverinstallatie.

### 6. Lokaal werk veiligstellen vóór een ander webadres

Neem alle desktops door. Download herstelkopieën waar synchronisatie openstaat. Behoud originele bestanden en mutatie-identiteiten. Synchroniseer via een bevoegde manager of reconcileer gecontroleerd met de doelkopie. Een SQL-dump bevat dit uitsluitend lokale werk niet.

Wis geen browsergegevens. Een ander domein heeft een andere browser-origin en krijgt geen toegang tot de oude IndexedDB-opslag of sessies. De bestaande `grade-app-three.vercel.app`-origin kan niet zoals een eigen DNS-subdomein naar de bedrijfsserver worden verplaatst. Spreek een eigen HTTPS-webadres af en handel de oude werkplekgegevens eerst af.

### 7. Acceptatie op meerdere werkplekken

Controleer naast de automatische tests:

1. Twee medewerkers tegelijk: inloggen, laatste batch vinden en zoeken/scannen.
2. Account wisselen op dezelfde desktop; verversen en F5 zonder ongewenst sessieverlies.
3. Barcode/serienummer met voorloopnullen en laatste tekens; dubbele hits expliciet kiezen.
4. Grading afronden, specs aanvullen, opslaan en resultaat terugzien op een andere desktop.
5. Echte DYMO-labels, inclusief eventueel tweede reparatielabel, vanaf de werkplek.
6. Managercijfers, inzichten, accountaanmaak, standaardreset en verplichte wachtwoordwijziging.
7. Verbindingsverlies/uploadfout, volle kleine browsercache en herstel zonder dubbele registratie.
8. Gelijktijdige writes en bewuste 409: geen stil overschrijven of verloren werk.

Test HTTPS, browsertoestemming en de lokale DYMO-service met het nieuwe adres. De appserver neemt de USB-printer op de medewerkerdesktop niet automatisch over. Behoud de bestaande clientprintflow.

### 8. Definitieve overgang en terugval

Plan een kort schrijfstopmoment. Rond werk af, handel lokale wachtrijen af en maak de definitieve geverifieerde databasekopie. Zet pas daarna de afgesproken omgeving/URL om. Laat geen twee onafhankelijke databasekopieën tegelijk productie-writes ontvangen.

Bevestig commit/build, inhoud, lees-/schrijftest en back-upstatus. Bewaar de oude omgeving als herstelbron. Terugschakelen na nieuwe writes op het doel vereist eerst export/reconciliatie: alleen oude URL/code terugzetten kan nieuw werk verliezen.

### 9. Back-ups en beheer overnemen

Plan serverback-ups onafhankelijk van een aangemelde Windows-gebruiker. De huidige PowerShell-taak en DPAPI-configuratie verhuizen niet vanzelf naar Linux of een ander serviceaccount. Pas ook de onderhoudsdriver aan waar nodig.

Bewaar een tweede fysieke kopie en de AES-/herstelsleutel afzonderlijk. Test herstel in een geïsoleerde omgeving. Monitor back-updatum, schijfruimte, foutpercentages, wachtrijen en databaseverbindingen. Stem pool/proxy/capaciteit af op daadwerkelijk gelijktijdig gebruik.

## Bericht voor de developer

> De Grade-app wordt overgedragen naar Terabyte-BV/Grade-app. Code, beelden, tests, SQL-schema's en scripts staan in GitHub. De huidige app draait op Vercel met een PostgreSQL-recorddatabase via de Neon HTTP-driver. De echte database en secrets staan niet in GitHub.
>
> Kun je bevestigen of we op de eigen server ook een eigen PostgreSQL gebruiken, of eerst de bestaande database behouden? Welke serveromgeving, PostgreSQL-versie en welk HTTPS-webadres zijn beschikbaar? Wie beheert export, back-ups en het omschakelmoment?
>
> Let op: npm start start momenteel de oude JSON-server. Eigen productiehosting vraagt een API-runtime en bij eigen PostgreSQL een passende database-adapter. Neem ook nog niet gesynchroniseerd werk van desktops mee. Het volledige plan staat in docs/SERVER-OVERDRACHT.md.

Dit is een concept om door te sturen; er is geen bericht naar de developer verstuurd.

## Bronnen

- Repository: `index.html`, `package.json`, `api/_lib/postgres-state.mjs`, `api/_lib/record-state.mjs`, `api/_lib/session-auth.mjs`.
- [Recordopslag en herstel](RECORD-STORAGE.md) en [recente reparaties](grading-result-labels-verification.md).
- [GitHub: transfers, behoud en redirects](https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository).
- [Neon: HTTP-/WebSocket-driver](https://neon.com/docs/serverless/serverless-driver).
