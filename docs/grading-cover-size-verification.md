# Behuizing en schermrand: groottebeleid — lokale controle 12 oktober 2026

Pre-releasecontrolesnapshot. Gebruiker heeft op 12 oktober 2026 publicatie goedgekeurd; de Vercel-status bij de GitHub-releasecommit bepaalt de uitrolstatus. Gegenereerde foto's blijven illustratieve voorbeelden, geen gekalibreerde meetbewijzen.

- Bovenkap/randen: grootste span van de ontbrekende/opengebroken sectie tot en met 3 cm C; boven 3 cm X. Geen scheurlengte of normale kier meten.
- Onderkant: breuk of ontbrekende opening op grootste span tot en met 5 cm C; groter dan 5 cm directe reparatie/X. Een afzonderlijk veiligheidsrisico blijft afkeur, ongeacht de grootte.
- Palmrest C: vier observaties (krassen, coating/lak, breuk, ontbrekende hoek). De laatste twee openen elk een maatvraag: tot en met 3 cm C/30 punten, groter dan 3 cm afkeur/X. X bevat alleen grote breuk, grote ontbrekende hoek en onafhankelijk veiligheidsrisico.
- Schermrand: duidelijke barsten/zwaar gebroken alleen bij C (30 punten). X bevat uitsluitend losse schermrand (directe reparatie) en scherpe rand (afkeur). De bestaande C-na-reparatieinschatting van losse/historisch gebroken schermranden blijft behouden; de UI geeft vóór herstel geen vrijgegeven grade.
- Bovenkap C begint met twee routes: Krassen, lakschade of deuken; Breuken/verbuiging. De bestaande slijtagepuntentelling blijft gelijk.
- X-ingangen bevatten uitsluitend X-/reparatiekeuzes, nooit de kleine opening of lichte verbuiging.
- Randen C → Zijkant gebroken vraagt de grootte: maximaal 3 cm C of groter dan 3 cm X. Poorten defect staat uitsluitend bij X, met functionele testherinnering en directe reparatie; geen vrijgegeven cosmetische grade vóór herstel.
- Scherpe rand bij bovenkap en randen direct C volgens expliciet managerbeleid. Andere onderdelen behouden hun reparatieregels.
- Licht verbogen bovenkap die normaal sluit: C. Niet kunnen sluiten: directe reparatie, geen vrijgegeven grade vóór herstel.
- Bestaande afgeronde beoordelingen blijven ongewijzigd. Oude onafgeronde begeleide concepten worden wegens de gewijzigde regel-/flowversie niet hervat.
- Bovenkapfoto's tonen 3 cm en 5 cm met dezelfde kijkhoek, liniaal en maatlijnstijl. Afgekeurde 2 cm en oude 4–5 cm kandidaten blijven bewaard maar worden niet geladen.
- Stap 3 gebruikt nu een nieuw 3cm-voorbeeld, niet meer de oude 1–2cm-foto. De grotere 4–5cm-foto is behouden; beide hebben dezelfde zwart/rode label- en maatlijnstijl.
- Palmrest: krassen opnieuw gegenereerd met minder heftige, afzonderlijke realistische sporen. Breuk en ontbrekende hoek hebben elk twee vergelijkbare close-ups (3 cm / 5 cm) met uitgelijnde rode maatlijnen zonder fysieke liniaal. Eerste kandidaten met verkeerde maatlijn en te zware krassen zijn afgekeurd, niet actief.
- Gegenereerde centimeterbeelden en liniaal zijn illustratief, niet gekalibreerd; altijd de echte laptop meten.

## Controle

- Gerichte foto-/beleidstests: 31 geslaagd, inclusief palmrestmaatvragen, correcties zonder verlies van zelfstandig veiligheidsrisico, schermrand C/X, oude reparatiehistorie, leverancieradvies en verwijdering van de actieve 1–2cm-foto.
- Volledige testset na sluiticoonfix: 315 tests geslaagd; JavaScript syntaxchecks, npm run check en git diff --check geslaagd.
- Impeccable detector gaf []. Bestaande compacte hoofdvergelijking blijft behouden; maximaal vijf detailkeuzes per actieve vraag, geen CSS-wijziging.
- Alle actieve vervolgvragen blijven onder 650 kB afbeeldingsdata (grootste vraag 559254 bytes) en 9 kB HTML. Nieuwe veiligheidsfoto onderkant: 160515 bytes, 1200×800 JPEG kwaliteit 82. Andere nieuwe JPEGs zijn 1200×800: bovenkap 3 cm 129852 bytes, bovenkap 5 cm 124657 bytes, defecte poort 117662 bytes.
- Nieuwe palmrest-JPEGs (kwaliteit 82, 1200×800): krassen 108712 B, coating 136327 B, breuk 3 cm 109091 B / 5 cm 97184 B, ontbrekende hoek 3 cm 109346 B / 5 cm 99794 B, veiligheidsrisico 156508 B. Vier C-keuzes samen 463476 B; X 353486 B; maatvragen circa 206–209 kB. Nieuw zijkantvoorbeeld 3 cm: 83134 B.
- Alleen de actieve vraag laadt, geen PNG-bronbestanden of extra databaseverkeer.
- Previewserver retourneert HTTP 200 met actuele build op http://127.0.0.1:8092/grading-preview en blokkeert API-verkeer. Werkt uitsluitend met testapparaat, geen operationele gegevens of echte printer.
- Visuele browsercontrole niet uitgevoerd: browserinventaris gaf apps:[], browsers:[]. Daarom zijn daadwerkelijk passen in elke schermhoogte, focus en vertaalde tekst in een echte browser nog handmatig te controleren.

## Handmatig bekijken

Open de lokale preview, bevestig schoonmaken en kies Bovenkap C → Breuken/verbuiging → Bovenkap gebroken. Vergelijk de 3 cm- en 5 cm-foto's. Controleer ook de scherpe rand en lichte verbuiging via dezelfde structurele route, plus X → Sluit niet goed. C → slijtage bevat de drie bestaande cosmetische keuzes.

Bij stap 3 Randen en hoeken: C → Zijkant gebroken toont de groottevergelijking. X toont uitsluitend de grote opening en defecte poorten. Controleer Poorten defect uitsluitend vanuit X: reparatieoverzicht, geen vrijgegeven C-label. C bevat deze optie niet.

Bij stap 2 Onderkant: C → Gescheurd/gebroken en X → Onderkant gebroken openen allebei de 5cm-vraag. De kleine variant geeft 30 punten/C; de grote variant directe reparatie/X. De nieuwe veiligheidsfoto toont een groot opengebroken gat met scherpe randen. Klein kiezen mag een afzonderlijk vastgelegd veiligheidsrisico niet verwijderen. De eerder goedgekeurde foto's van de zijkant zijn behouden.

Bij stap 4 Palmrest: C toont vier keuzes in de bestaande compacte indeling. Controleer de nieuwe krassen en coatingfoto, daarna de twee afzonderlijke maatvragen voor breuk/ontbrekende hoek. Vergelijk in elke vraag 3 cm met 5 cm. X toont alleen grotere schade/veiligheidsrisico. Bij stap 5 Schermrand: C → duidelijke barsten/zwaar gebroken; X uitsluitend los/scherpe rand. Geen dubbele gebroken-keuze onder X.

Foto's en exacte ingebouwde imagegen-prompts staan in grading-lid-size-examples.json, grading-edge-size-examples.json en grading-edge-ports-example.json. De nieuwe 5cm-regel en veiligheidsfoto inclusief exacte prompt staan in grading-bottom-size-policy.json. Afgekeurde varianten staan alleen in historische ledgers en worden niet gebruikt. Lokale generatie-manifesten met absolute gebruikerspaden niet publiceren.

De zeven nieuwe palmrestfoto's, exacte ingebouwde image_gen-prompts en afgekeurde kandidaten staan in grading-palmrest-size-policy.json. Het nieuwe 3cm-zijkantvoorbeeld staat in grading-edge-size-examples.json, inclusief de vervangen 1–2cm-variant als historische kandidaat. Build: 20261012-cover-size-policy-v6; regelversie v4, begeleide flow v8.

Geen databases, accounts, batches of bestaande beoordelingen gemigreerd. Voor publicatie uitsluitend de relevante applicatiebestanden, compacte foto's, test- en promptdocumentatie selecteren. Onverwante werkboomwijzigingen behouden.

## Aanvulling: zichtbare sluiticonen

- Oorzaak lege knop: uiIcon gaf open SVG-paden zonder eigen stroke/fill-defaults terug; informatiebalken hadden alleen icoonafmetingen, geen tekenstijl. Schermspecifieke SVG-stijlen maskeerden dit elders.
- uiIcon tekent nu zelfstandig met fill=none, stroke=currentColor, stroke-width=1.8. Gedeelde informatieknop houdt 40×40 klikruimte, gecentreerd 20px-kruisje, zichtbare hover/focus en thema-afhankelijke kleur. Bestaande sluitacties, waarschuwingen en afbeeldingruimte ongewijzigd; geen extra requests.
- Regressietest reproduceerde het onzichtbare kruis vóór herstel en slaagt na herstel, inclusief gegevensbescherming, tijdelijke werkdatabase, algemene berichten en lokale werkmodus. Bestaande tests bewaken dat sluiten invoer/beoordeling niet opnieuw opbouwt en blokkerende opslagfouten niet verbergt.
- Detector: bestaande CSS-waarschuwingen buiten het gewijzigde sluitknopblok ongemoeid gelaten; geen brede restyling. Visuele browsercontrole blijft niet beschikbaar (apps:[], browsers:[]); bron-, gedrag- en productiebestandscontrole uitgevoerd.
- Releasebuild inclusief fotobeleid en sluiticoonfix: 20261012-visible-notice-close-v1.
