# Live runbook

De huidige productie gebruikt PostgreSQL-recordopslag v3. De oude KV- en lokale JSON-instructies zijn geen reguliere releaseprocedure.

1. Controleer repository, branch, commit en doelomgeving. Bedrijfsrepository voor de overdracht: `Terabyte-BV/Grade-app`, branch `main`. Controleer de expliciete remote: een lokale remote kan een ander project aanwijzen.
2. Voer `npm test` uit voor de volledige suite. Alleen de grading-smoketest is onvoldoende. Voer ook `npm run check`, syntaxchecks voor gewijzigde browserbestanden en `git diff --check` uit.
3. Controleer configuratie zonder waarden te publiceren: effectieve database-URL, `REMARKT_STORAGE_FORMAT=3`, bestaande workspace en sessiesleutel. Een gewone release vraagt geen KV-import, seed of databasemigratie.
4. Houd operationele data, herstelkopieën en geheimen buiten Git en de publieke documentroot. Bewaar werk van desktops met openstaande synchronisatie.
5. Bij Vercel: controleer de GitHub App-toegang na repositorytransfer. Wacht op Ready voor de juiste commit in het juiste project/team. Controleer productiealias en buildmarkering in `index.html`.
6. Controleer gewijzigde live bestanden en begrensde runtime-logs. Bekijk endpointmetrics in de geneste requestlogs; alleen error-level is onvoldoende voor applicatie-403/409/429. Log geen tokens of records.
7. Test met een geautoriseerde sessie: login, nieuwe batch/scannen, opslaan en Manager Live. `/api/health` en `/api/stats` zijn in v3 beveiligd; anonieme 401 betekent niet dat de database defect is. Gebruik afgesproken testapparatuur voor echte writes/prints.
8. Laat betrokken werkplekken de nieuwe code laden. Verversen leest gegevens; Ctrl+F5 haalt ook nieuwe scripts op. Wis geen browseropslag als synchronisatie openstaat. Een geslaagde publicatie bewijst geen herstel van iedere lokale werkplek.

Bij falende checks niet publiceren totdat de oorzaak is opgelost of expliciet afgestemd. Voor databaseverhuizing geldt het afzonderlijke [migratie- en terugvalplan](SERVER-OVERDRACHT.md), inclusief schrijfstop, gecontroleerde export, lokaal werk en proefherstel.
