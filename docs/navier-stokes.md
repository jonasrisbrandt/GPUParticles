# Navier–Stokes: en kollapsande virvelkärna

Välj **Navier–Stokes** i Formation. Läget visar en interaktiv **skalmodell**, med GPU-partiklar som spårämnen i ett föreskrivet hastighetsfält. Det implementerar inte hela OpenAI-konstruktionen, verifierar inte beviset och är ingen numerisk Navier–Stokes-solver.

## Kopplingen till artikeln

OpenAI beskriver ett påtvingat flöde som börjar i vila och får obegränsad hastighet vid ändlig tid, med begränsad kinetisk energi. Kärnan kombinerar radiellt inflöde, rotation och axiellt utflöde. Konstruktionen omfattar också oscillationer och korrigeringar som behövs för en slät yttre kraft. Se [artikeln, 8 september 2026](https://openai.com/index/navier-stokes-solution/) och [originalrapporten, avsnitt 2](https://cdn.openai.com/pdf/32d9f210-8b73-45e0-91bc-82a30aef8a9a/navier-stokes.pdf).

Vi använder rapportens skalexponenter: med τ = 1 − t är radialskalan proportionell mot τ^½, axialskalan mot τ^(½−h), och rotations-/axialhastigheten mot τ^(−½−h). Här väljer vi h = 0,005. Båda längdskalorna krymper; materialets axiella utflöde betyder alltså inte att den intensiva regionens absoluta höjd växer. [Rapportens sida 4](https://cdn.openai.com/pdf/32d9f210-8b73-45e0-91bc-82a30aef8a9a/navier-stokes.pdf#page=4).

Den publicerade [Lean-formaliseringen](https://github.com/openai/NavierStokesAndEuler) är en separat resurs. AETHER kör ingen Lean-kod.

## Partiklar som följer osynliga guider

Den aktuella versionen är en formgiven guideanimation inspirerad av figuren. Den tidigare analytiska bakgrundsadvektionen och de synliga banden är ersatta. 64 osynliga spiralguider bestämmer formen; vanliga, separata GPU-partiklar flödar längs dem från ytterområdet mot axeln och vidare uppåt eller nedåt. Inga rör, band eller sammanhängande linjer ritas.

Varje partikel har ett stabilt slumpfrö och en egen startfas. Under 24 sekunder vid hastighet 1 färdas den längs sin guide enligt:

```text
p = clamp(sekunder / 24, 0, 1)
τ = 1 − 0,96p
fas = fract(startfas + 0,065 sekunder + 0,003 sekunder²)
radial formfaktor = τ^0,42
axial formfaktor = 1 + 1,1p
```

Vid slutet är radialskalan cirka 26 procent och höjdskalan 210 procent av startvärdet. Guiderna får också fler spiralvarv. Axial sträckning är avsiktligt förstärkt för att göra förloppet tydligt: detta är inte rapportens fysiska längdskalor. Kameran flyttas inte under förloppet. Den inledande kameravyn lämnar utrymme för utdragningen.

Partiklarna har liten individuell spridning runt guiderna och varierad ljusstyrka så att de förblir synliga som punkter. När en partikel når änden tonas den ut och återkommer vid inflödet. Positionen beräknas på GPU:n; alla valda partiklar visas, upp till 4 194 304. Bufferten är fortfarande 32 byte per partikel. De extra band-/djupmålen och MSAA från rörversionen behövs inte längre.

## Tidsreglaget spelar samma animation

Partikelposition, guidernas deformation, rotation, turbulens och flödesfas beräknas från absolut animationstid. Uppspelning till 12 sekunder ger därför samma partikelbild som att dra reglaget till 12 sekunder, med samma frö och interaktionsinställningar.

Vid dragning håller uppspelningen stilla medan reglaget bestämmer tiden. När handtaget släpps fortsätter animationen om den inte var pausad. I pausat läge går det att stega både framåt och bakåt. Den första bildrutan efter en tidsändring visar exakt den valda tiden. Kameran påverkas inte och partiklarna byts inte ut mot en skalad startfigur.

Musen deformerar partikelpositionerna runt den aktuella pekaren. Tidigare musrörelser spelas inte in; vid tidsdragning används den aktuella muspåverkan. B ger en avklingande radiell impuls. Den senaste impulsens tid sparas tills Återställ, så att tidsreglaget också kan visa den pulsen igen.

## Kontroller och färg

- Vänster musknapp drar, Shift stöter bort. Muskraft styr styrkan.
- Turbulens ger små böljande avvikelser kring guiderna.
- Partikelstorlek ändrar punkternas storlek; Bloom och Exponering styr ljuset.
- Standardfärgen går från turkos via blått till guld närmare axeln. Den är illustrativ, inte en kalibrerad hastighets- eller temperaturskala.
- Återställ börjar om tiden och väljer ett nytt partikelmönster. Byte av antal börjar också om.
- Vid slutpunkten stannar visningen. Dra tiden tillbaka eller återställ för att fortsätta.

## Verifiering

`npm test` kontrollerar tidsgränsen samt att guiderna blir smalare och högre. `tests/gpu-smoke.html` jämför faktisk GPU-partikeldata efter 240 uppspelningssteg med direkt tidssökning till samma tid; båda tillstånden måste vara identiska. Testet provar också bakåt/framåt, musdeformation, paus, slutpunkt, återstart, upp till 4M partiklar och växling mellan alla formationer.

Detta verifierar animationen och renderingen, inte ett singularitetsbevis eller en Navier–Stokes-solver.
