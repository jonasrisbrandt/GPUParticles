# Navier–Stokes: en kollapsande virvelkärna

Välj **Navier–Stokes** i Formation. Läget visar en interaktiv **skalmodell**, med GPU-partiklar som spårämnen i ett föreskrivet hastighetsfält. Det implementerar inte hela OpenAI-konstruktionen, verifierar inte beviset och är ingen numerisk Navier–Stokes-solver.

## Kopplingen till artikeln

OpenAI beskriver ett påtvingat flöde som börjar i vila och får obegränsad hastighet vid ändlig tid, med begränsad kinetisk energi. Kärnan kombinerar radiellt inflöde, rotation och axiellt utflöde. Konstruktionen omfattar också oscillationer och korrigeringar som behövs för en slät yttre kraft. Se [artikeln, 8 september 2026](https://openai.com/index/navier-stokes-solution/) och [originalrapporten, avsnitt 2](https://cdn.openai.com/pdf/32d9f210-8b73-45e0-91bc-82a30aef8a9a/navier-stokes.pdf).

Vi använder rapportens skalexponenter: med τ = 1 − t är radialskalan proportionell mot τ^½, axialskalan mot τ^(½−h), och rotations-/axialhastigheten mot τ^(−½−h). Här väljer vi h = 0,005. Båda längdskalorna krymper; materialets axiella utflöde betyder alltså inte att den intensiva regionens absoluta höjd växer. [Rapportens sida 4](https://cdn.openai.com/pdf/32d9f210-8b73-45e0-91bc-82a30aef8a9a/navier-stokes.pdf#page=4).

Den publicerade [Lean-formaliseringen](https://github.com/openai/NavierStokesAndEuler) är en separat resurs. AETHER kör ingen Lean-kod.

## Vår förenklade profil

Profilen nedan är vår egen illustrativa konstruktion, inte rapportens exakta profil. AETHER använder y som vertikal axel och r = √(x²+z²).

```text
R = 3√τ                 Z = 4τ^0,495
q = r²/R²               s = y²/Z²
E = exp(−q−s)           a = 0,7/τ

ψ = a r² y E
u_r = −(1/r) ∂ψ/∂y = −a r E(1−2s)
u_y =  (1/r) ∂ψ/∂r =  2a y E(1−q)
u_θ = 8τ^−0,505 (r/R) E
```

Strömfunktionen ψ gör det radiella/axiella bakgrundsfältet divergensfritt analytiskt. Den axialsymmetriska rotationen tillför ingen divergens. I shadern räknas allt i kartesiska koordinater utan division med r, vilket undviker en numerisk specialpunkt på axeln.

Nära mittplanet går material inåt. Nära axeln leds det uppåt respektive nedåt; längre ut vänder cirkulationen. Vid fasta normaliserade koordinater får profilen de angivna skalexponenterna. Detta räcker inte för att återge rapportens lösning: vi löser varken tryck, viskositet, kraftresidual eller dess korrigeringar. Modellen startar med ett redan rörligt fält.

## GPU och tid

`src/collapse.js` definierar ett 24 sekunder långt visningsförlopp vid hastighet 1. Fysikalisk modelltid går från 0 till 0,96. Vid slutet är τ = 0,04, radien 0,20 gånger startskalan och fartskalan ungefär 5,08 gånger större. Vi utvärderar aldrig t = 1.

Renderern klipper sista tidssteget exakt vid gränsen. Compute-shadern använder explicit mittpunktsintegration (RK2) av bakgrundsfältet. Det vanliga flödets hastighetsdämpning och farttak används inte här. När tidsgränsen nås hålls partiklarna stilla; kameran kan fortfarande röra sig. Dra tillbaka tidsreglaget eller välj Återställ för att fortsätta ett nytt förlopp.

Tidsreglaget initierar nya spårpartiklar vid den valda tiden. Det spolar inte tillbaka samma partikelbanor. Även partiklar som lämnat visningsregionen eller levt färdigt återföds. Därför representerar antalet synliga partiklar varken massa, densitet eller kinetisk energi. Byte av partikelantal startar om förloppet.

De nio initiala spiralbanden är en visuell sådd av spårämnen. Turkos–orange visar relativ lokal vinkelhastighet, normaliserad inom den aktuella tidsbilden. Det är ingen temperaturskala. De andra paletterna fungerar också. HDR-ljuset kompenseras under kontraktionen för att bevara färg, och vanlig bloom ger glöden.

## Interaktion och experiment

- Börja med standardpaletten Ion, 524 288 partiklar och hastighet 1.
- Sätt Turbulens och Muskraft till 0 för att studera enbart bakgrundsprofilen. B-impulsen är också ett fritt visuellt tillägg.
- Pausa, flytta tidsreglaget och rotera kameran för att jämföra kärnans form.
- Återställ och prova vänster musknapp eller Shift för att störa spårpartiklarna.
- Prova 4M om GPU:n stöder det. Inga extra partikelbuffertar behövs för detta läge.

## Verifiering

`npm test` kontrollerar skalornas riktning och den ändliga tidsgränsen. `tests/gpu-smoke.html` kompilerar riktiga shaders, läser partikeldata nära bufferns början och slut, provar tidpunkterna 0, 12, 23,99 och 24 sekunder och kontrollerar att slutpunkten fryser tillståndet. Testet provar även paus, återstart, interaktion, största tillåtna partikelbuffert och växling till och från Black hole. Testerna verifierar implementationens stabilitet, inte ett matematiskt singularitetsbevis.
