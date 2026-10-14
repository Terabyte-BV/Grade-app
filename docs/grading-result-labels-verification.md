# Beoordelingsoverzicht: labelaantal, inhoud en reparatieuitleg

Build: `20261012-result-label-plan-v1` (12 oktober 2026).

## Wijziging

- Direct onder de beoordeling, vóór de onderdelentabel, staat of één of twee labels worden geprint. De bevestigknop vermeldt hetzelfde aantal.
- Een gedeelde `getLaptopLabelPrintTypes` gebruikt de bestaande `needsProblemLabel`-controle voor overzicht, bevestigen, opnieuw printen en label-only scannen. Geen nieuwe reparatieregels; cosmetische C alleen veroorzaakt geen extra label.
- Per label opent een native, met toetsenbord bedienbaar details-element de inhoud. De vier tekstregels komen uit dezelfde `getLabelRows` als de printjob en worden HTML-escaped. Deze inhoudsvoorbeelden blijven in de werkelijke labeltaal; de omgeving is Nederlands/Engels vertaald. Geen DYMO-aanroep, afbeelding, printvenster of netwerkverzoek voor een voorbeeld. Het voorbeeld is geen exacte simulatie van DYMO-lettergrootte of regelafbreking.
- Een extra label toont het juiste doel: directe reparatie, productie, niet verkoopbaar, of een nog te controleren reparatiemelding zonder route. Alle reparatiepunten worden getoond, ook wanneer slechts twee op het fysieke label passen.
- Directe reparatie met uitgestelde grade toont de lege graderegel; productie toont de grade na reparatie. Bij afkeur staat de vastgelegde beleidsreden erbij. Ontbrekende omschrijving levert een duidelijke controle-instructie op, geen verzonnen reparatie.
- Testgrading toont voorbeeldlabels met expliciete melding dat niets wordt geprint/opgeslagen. De bestaande automatische afronding/printflow blijft ongewijzigd; dit voegt geen nieuwe verplichte bevestigingsstap toe.
- Bestaande losse herprintknoppen blijven beschikbaar bij de berekening. Dubbele, minder duidelijke tekstvoorbeelden en de oude reparatiezone onder de tabel zijn vervangen door het gezamenlijke printoverzicht boven de tabel.

## Verificatie

- Volledige testset: 317 geslaagd, 0 mislukt.
- Gerichte tests voor normale beoordeling, cosmetische C, directe reparatie, productie, afkeur, oude records met alleen repairPolicy.labelType, leverancier-reparatiemelding en ontbrekende omschrijving. Getoonde aantallen en elke voorbeeldregel vergeleken met daadwerkelijk samengestelde printjobs (printer en opslag uitsluitend gesimuleerd).
- Voorbeeldweergave verandert de beoordeling/historie niet en escape't vrije reparatietekst. Alle reparaties blijven zichtbaar zonder de bestaande fysieke labelinhoud te wijzigen.
- JavaScript-syntaxchecks, npm run check en git diff --check geslaagd.
- Eén gezamenlijke Impeccable-detectorcontrole uitgevoerd: bestaande waarschuwingen buiten het nieuwe printoverzicht ongemoeid gelaten.
- Visuele browsercontrole niet beschikbaar: browserinventaris gaf apps:[], browsers:[]. Geen claim dat fysieke printeruitvoer of browserlayout visueel getest is. Handmatig nog bekijken in licht/donker, smal/breed en met lange reparatieomschrijving; beide 'Bekijk dit label'-elementen openen zonder printactie.

Geen database-, account-, batch-, historische beoordeling- of gradingregelwijzigingen. Alleen lokaal gewijzigd; deze aanvulling is nog niet gepubliceerd.

## Aanvulling 14 oktober: kleine letters en verversen

- Foto van batch 28692: `Dell Inc. Latitude 7400` met CPU `Intel(R) Core(TM) i7-8665U CPU @ 1.90GHz`. De volledige CPU-regel activeert in de bestaande DYMO-code de compacte variant voor alle regels (titel 9,5 pt, specificaties 6,8 pt). Het gaat om te kleine letters, niet aangetoond verkeerd papierformaat.
- Met toestemming van de gebruiker print-only merk-/CPU-compactering toegevoegd: `Dell Latitude 7400` en `i7-8665U / 16GB / 512GB`. Hiermee gebruikt hetzelfde bestaande template weer 13 pt / 8,8 pt. Import, opgeslagen CPU, RAM, SSD, grade en touchscreen blijven ongewijzigd. Modelsuffixen en aantallen blijven behouden; onbekende CPU-families worden niet geraden. Geen wijziging van labelafmetingen, printerinstellingen of DYMO-template.
- Nieuwe knop Verversen met gedeelde laadfeedback: lichte revisiecontrole, gewijzigde gegevens alleen laden wanneer nodig, geen documentreload/logout. Dubbelklik wordt samengevoegd; lopende acties worden niet doorkruist. Formulieren met DOM-invoer blijven staan, begeleide concepten worden lokaal bewaard. F5 zelf herstelt niet automatisch het geopende formulier; de nieuwe knop bewaart de huidige werksituatie.
- F5 met bestaande servertoken verifieert via GET /api/session dezelfde getekende sessie en haalt alleen het eigen openbare profiel op, onafhankelijk van ontbrekende/oude accountcache. Bestaande 12-uursduur wordt niet verlengd. De normale accountgebonden API-rate-limit blijft gelden. Geen wachtwoord opnieuw versturen of plaintext opslaan. Verlopen, vervalste of door wachtwoordwijziging ingetrokken tokens blijven geweigerd; verplichte wachtwoordwijziging blijft verplicht.
- Offline inloggen na echte lokale wachtwoordverificatie krijgt een tabgebonden hervatbewijs van maximaal 12 uur. F5 verlengt dit niet. Herstel vereist dezelfde werkdatabase, recente geldige offline verifier, ongewijzigde rechten en beschikbare duurzame werkopslag. Logout, reset-login en afgewezen serversessies wissen het tabbewijs. Een andere tab zonder dit bewijs logt niet automatisch in.
- Regressietests reproduceren de kleine letters met exact de fototekst en vergelijken oude/nieuwe lettergroottes. Sessietests dekken ontbrekende accountcache, F5, logout, reset-login, offline verversen, ingetrokken sessies, formulierbehoud en dubbele refresh. API-sessiecontrole ook getest tegen de echte handler met geïsoleerde in-memory SQL; geen productieaccounts of gegevens gewijzigd.
- Bestaande detectorwaarschuwingen buiten deze wijziging behouden. Arial op de thermische labels blijft bewust behouden wegens het bestaande DYMO-template; dit is geen websitelettertype-keuze.
- Geen gekoppelde browser beschikbaar (apps:[], browsers:[]). Geen fysieke proefprint uitgevoerd. De oorspronkelijke Excel op E: en de schijf D: zijn in deze omgeving niet gekoppeld; verificatie gebruikt de zichtbare gebruikersfoto en de bestaande import-/printcode, niet alle rijen van de operationele batch.
- Nieuwe build: `20261014-label-font-session-refresh-v1`. Deze wijzigingen zijn lokaal, nog niet live.
- Definitieve volledige testset: 327 geslaagd, 0 mislukt. Aanvullende controles bewaken dat een geldig account bij corrupte/onveilige werkgegevens nooit ingebouwde voorbeeldvoorraad opent en dat F5 via echte sessie- en werkdatahandlers werkt zonder wachtwoord opnieuw te versturen. Syntaxchecks en git diff --check geslaagd.

## Compacte menubalk en gezamenlijke release

- Taal, licht/donker, contrast en volledig scherm gebundeld onder één native instellingen-dropdown. Verversen, terug/home en uitloggen blijven direct bereikbaar. Geen functies verwijderd en geen extra requests of assets.
- Het menu gebruikt details/summary plus een gelabelde groep, niet een ARIA-menu met onvolledige toetsafhandeling. Tab/Enter/Spatie blijven native; Escape sluit alleen instellingen en brengt focus terug. Buiten klikken sluit zonder beoordeling of invoer te renderen. Voorkeur wijzigen houdt het menu en de bedieningsfocus op dezelfde pagina vast; navigatie/accountwisseling sluit het menu.
- Dropdown ligt over de pagina, neemt geen extra hoogte van de gradingfoto's in, gebruikt bestaande licht/donker-kleuren en begrenst de breedte op kleine schermen. Sliders- en chevroniconen zijn zelfstandige SVG's.
- Drie extra regressietests voor groepering, buitenklik/Escape en openhouden tijdens voorkeur-render versus paginawissel. Detectorcontrole: geen bevindingen in de gewijzigde menubalk; oude CSS-waarschuwingen elders behouden. Visuele browsercontrole blijft niet beschikbaar; inventaris apps:[], browsers:[].
- Gezamenlijke releasebuild: `20261014-compact-toolbar-v1`, inclusief het labeloverzicht, grotere labelletters en sessie-/refreshherstel. Gebruiker heeft publicatie van alles samen expliciet gevraagd. Geen migraties, accountresets of wijzigingen aan operationele batchgegevens.
- Volledige gezamenlijke releasecontrole: 330 tests geslaagd, 0 mislukt; npm run check, gewijzigde JavaScript-syntaxchecks en git diff --check geslaagd.

## Zoeken met een deel van barcode of serienummer

- Gebruiker vroeg aanvullend om laatste 5/6 tekens (geen vaste vereiste lengte) in het gewone scanveld te kunnen typen en mogelijke apparaten te kiezen, inclusief directe livegang.
- Zowel Apparaat scannen als Label scannen krijgt lokale suggesties onder het scanveld. Vergelijkt barcode en serienummer hoofdletterongevoelig, inclusief een deel middenin of aan het einde. Behoudt echte barcodes, leest geen nieuwe databasepagina's en wijzigt geen geïmporteerde gegevens. Bestaande zoekveld voor merk/model/batch blijft aanwezig.
- Maximaal tien zichtbare keuzeknoppen met model, volledige barcode, serienummer en batch; bij meer matches instructie om verder te verfijnen. Geen 10.000-regelige DOM. Typen is 120 ms gedebounced en vervangt alleen het resultatenfragment; geen volledige render of verlies van invoer/focus. Late resultaten na navigatie worden genegeerd.
- Volledige unieke codes gebruiken de bestaande route met de canonieke leveranciersbarcode. Een gedeeltelijke match start nooit automatisch, ook niet wanneer er één is. Meerdere hits vragen expliciete selectie; een exacte korte code die ook het einde van andere barcodes is, wordt niet automatisch gekozen. Exacte matches staan bovenaan. Geen afleiding van de laatste tekens van een onbekende scanprefix.
- Reeds afgeronde apparaten houden de bestaande herprint/hergrade-waarschuwing. Label-only suggesties gebruiken uitsluitend de bestaande printselectie; er wordt niets geprint door te typen of Enter op een deelcode te drukken.
- Negen gerichte tests voor lange codes, suffixen en middenstukken, hoofdletters/spaties, onbekende scannerprefix, exacte code versus suffixbotsing, dubbel serienummer, barcodeprioriteit, labelselectie via eventdelegatie, bestaande herprintwaarschuwing, debouncing en 10.000 kandidaten met maximaal tien veilige knoppen onder 14 kB. Geen productieprinter of operationele gegevens gebruikt.
- Build: `20261014-partial-code-search-v1`. Bestaande menu-/sessie-/labelfixes blijven meegenomen. Browserinventaris blijft leeg; bron-/gedragstests en live-bestandscontrole zijn de verificatiemiddelen, geen claim van visuele browser- of scannerhardwaretest.
- Volledige testset: 339 geslaagd, 0 mislukt. Na het stoppen van achterlopende zoek-timers bij selectie/herprint/labelprint nogmaals 19 gerichte scan-/duplicate-workflowtests geslaagd. npm run check, syntaxchecks en git diff --check geslaagd. Detector heeft geen bevindingen in de gewijzigde scancomponent; bestaande CSS-waarschuwingen elders ongemoeid gelaten.
