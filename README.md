# AETHER — Particle flow laboratory

En interaktiv 3D-demoscen med upp till **4 194 304 GPU-partiklar**. WebGPU och WGSL, utan ramverk, npm-beroenden eller nedladdade bildresurser.

**[Öppna live-demon](https://jonasrisbrandt.github.io/GPUParticles/)** · [Källkod på GitHub](https://github.com/jonasrisbrandt/GPUParticles)

Svensk tutorial: [Från GPU-partiklar till fluidliknande 3D – en tur genom AETHER](docs/webgpu-tutorial.md). Följ CPU/GPU-dataflödet, compute-simuleringen, 3D-kameran, muskraften, partikelrenderingen och bloom steg för steg, med kodexempel och egna experiment.

## Starta

```sh
npm start
```

Öppna **http://127.0.0.1:5174** i Chrome eller Edge med WebGPU och hårdvaruacceleration. Kräver Node.js 20.11 eller senare. `PORT` kan ändra porten. Google Fonts är valfria; systemtypsnitt används offline.

## Kontroller

| Kontroll | Funktion |
| --- | --- |
| Musrörelse | Svag påverkan på flödet |
| Vänster musknapp | Attrahera och virvla partiklar |
| Shift + mus | Stöt bort partiklar |
| Höger musknapp + dra | Rotera kameran |
| Mittenknapp + dra | Panorera |
| Mushjul | Zooma |
| WASD / pilar | Flytta kameran |
| Q / E | Flytta ned / upp |
| Mellanslag | Pausa / fortsätt; kameran fungerar även under paus |
| B | Radiell impuls |
| R | Återställ partiklar och kamera |
| H | Visa / dölj gränssnitt |
| F | Helskärm |

Muskraftens centrum ligger på ett plan genom kamerans fokuspunkt, vinkelrätt mot kameran. Kraften påverkar en volym runt denna punkt och avtar med 3D-avståndet. Panorera och rotera för att påverka olika delar av volymen. Primärt byggt för dator med mus och tangentbord; ett finger kan påverka partiklar på pekskärm.

## Simuleringen

**Black hole** är den fjärde formationen: en tunn ackretionsskiva av GPU-partiklar, ett mörkt centrum och gravitationellt böjda ljusbanor. Läget väljer automatiskt den Interstellar-inspirerade paletten **Gargantua** med bärnsten, guld och vitgul innerkant, samt en låg kameravinkel. Musen påverkar materialet i skivplanet; kamera, paus, impuls och antalsreglage fungerar som vanligt. Den tidigare paletten återställs när du lämnar läget.

Detta är en förenklad visualisering av ett icke-roterande svart hål, inte filmens Kerr-simulering. Ljusbanorna samplar en 1024×1024 HDR-bild av de faktiska partiklarna; strålspårningen och denna extra textur (8 MiB) gör läget tyngre än övriga formationer. Läs [så fungerar Black hole](docs/black-hole.md).

Vortex bildar en turbulent torus, Nebula ett viktlöst moln och Stream fem helixströmmar. Ett analytiskt divergensfritt ABC-fält i två skalor skapar fluidliknande rörelse. Formationernas egna krafter, tröghet och mjuk begränsning håller flödet samlat. Det är en visuell flödessimulering, inte en fysikalisk vätskesolver med tryck, densitet eller partikelkollisioner.

Varje partikel använder 32 byte: position + färgfrö och hastighet + återstående livslängd. Initiering, återfödelse och rörelse sker i compute shaders (256 trådar per arbetsgrupp). Ingen partikeldata läses tillbaka till CPU:n under körning. En instansierad draw skapar hastighetsorienterade ljusstreck i ett HDR-mål (`rgba16float`). Fem bloom-nivåer kombineras före tonmappning. Färg följer positionen i flödet; ljusstyrkan kompenseras efter antalet partiklar.

524 288 partiklar är standard (16 MiB). 1M / 2M / 4M använder 32 / 64 / 128 MiB för partikelbufferten. HDR- och bloom-texturer tillkommer. Alternativ begränsas efter GPU:ns buffergränser. Bildhastigheten beror på GPU, upplösning och partikelstorlek; renderingen begränsas till 2,4 miljoner pixlar och högst 1,5× skärmskalning. Sänk antal eller partikelstorlek om det behövs. Alla kvalitetsreglage är direkta; byte av antal eller formation startar om partiklarna.

## Utveckling

### Publicering med GitHub Pages

Webbplatsen publiceras direkt från `main`, mappen `/ (root)`, via repositoryts **Settings → Pages → Deploy from a branch**. Filen `.nojekyll` gör att filerna serveras utan Jekyll-bearbetning. Varje push till `main` uppdaterar demon efter att GitHubs publicering är klar.

Ingen npm-installation, byggprocess eller Node-server behövs på webbhotellet. `index.html`, `style.css` och `src/` är hela applikationen; relativa sökvägar fungerar även under `/GPUParticles/`. GitHub Pages serverar sidan över HTTPS. Besökarens webbläsare och GPU måste fortfarande stödja WebGPU.

För att uppdatera: kör `npm test`, provkör lokalt med `npm start`, committa och pusha till `main`. Publiceringsstatus finns under **Actions**. Vid flytt till ett annat konto eller repository behöver länkarna ovan uppdateras.

### Tester och kod

`npm test` verifierar WebGPU-kamerans djupkonvention, musplanets projektion och kameragränser. Shaderkompilering kontrolleras vid start, och GPU-fel visas i gränssnittet. `window.aether.diagnostics` visar aktuell konfiguration, renderade bildrutor och GPU-fel i webbläsarkonsolen.

För GPU-integrationstester: starta servern och öppna [GPU checks](http://127.0.0.1:5174/tests/gpu-smoke.html). Testet kompilerar samtliga shaders, växlar formationer och bufferstorlekar, läser tillbaka poster från bufferns båda ändar och verifierar ändligt tillstånd samt paus/fortsättning. GPU-readback används endast i testet.

- `src/shaders.js`: GPU-simulering, partiklar, bloom och tonmappning.
- `src/renderer.js`: GPU-resurser och renderpass.
- `src/math.js`: kamera och projektionsmatematik.
- `src/main.js`: interaktion och inställningar.
