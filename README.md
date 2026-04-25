# VirtualClubDancers

Virtual Club Dancers — Twitch Chat-gesteuertes OBS-Overlay mit South-Park-Stil animierten Avataren.

## Features

- **Transparentes OBS-Overlay** — Nur Avatare auf transparentem Hintergrund, kein Schnickschnack
- **Twitch Chat-Steuerung** — Zuschauer steuern Avatare via Chat-Befehle
- **48 Tanz-Emotes** — Disco, Floss, Nae Nae, Breakdance, Moonwalk, Macarena und viele mehr
- **20 Soziale Emotes** — Winken, Lachen, Trinken, Essen, Umarmen, High-Five, Küssen, etc.
- **South-Park Cutout-Stil** — Flache 2D-Charaktere mit artikulierten Gelenken (10 Gelenkpunkte)
- **30-50 simultane Avatare** — Performant dank Canvas2D + Offscreen-Rendering
- **Beat-Sync** — Avatare wippen im Rhythmus der Musik (manuelle BPM-Einstellung)
- **2-Min Inaktivitäts-Timeout** — Inaktive Zuschauer verschwinden automatisch (Fade-Out)
- **Admin-Panel** — 5 Sektionen: Avatar-Management, Global Controls, Szene-Einstellungen, Twitch-Verbindung, Presets
- **One-Click Start** — Einfach starten, alles läuft automatisch
- **Perspektivische Skalierung** — Avatare weiter hinten sind kleiner, weiter vorne größer

## Installation

1. Lade die neueste `VirtualClubDancers-X.X.X-Portable.exe` von [Releases](https://github.com/nicetoTECHyou/VirtualClubDancers/releases) herunter
2. Starte die Anwendung
3. Gib deinen Twitch-Kanalnamen und OAuth-Token ein
4. Token generieren: [twitchtokengenerator.com](https://twitchtokengenerator.com/)
5. Füge das Overlay in OBS als "Window Capture" hinzu (Alpha-Kanal aktivieren)

## Chat-Befehle

| Befehl | Beschreibung | Cooldown |
|--------|-------------|----------|
| `!join` | Dem Club beitreten | 1x pro Session |
| `!leave` | Club verlassen | 10s |
| `!dance [name]` | Tanz-Emote ausführen | 5s |
| `!dance random` | Zufälligen Tanz ausführen | 5s |
| `!emote [name]` | Soziales Emote ausführen | 5s |
| `!hug @user` | Jemanden umarmen | 15s |
| `!highfive @user` | High-Five | 10s |
| `!kiss @user` | Küssen | 10s |
| `!box @user` | Boxen | 10s |
| `!color [part] [farbe]` | Avatar-Farbe ändern (shirt, pants) | 30s |
| `!list dances` | Verfügbare Tänze anzeigen | 30s |
| `!list emotes` | Verfügbare Emotes anzeigen | 30s |
| `!stop` | Animation stoppen, zurück zu Idle | 3s |

## Tanz-Emotes (48)

### Klassische Tänze: `disco`, `funky`, `robot`, `twist`, `mashpotato`, `swim`, `busstop`, `hustle`
### Hip-Hop / Street: `dab`, `floss`, `worm`, `dougie`, `naenae`, `shiggy`, `inmyfeelings`, `kick`
### Party Moves: `jump`, `spin`, `wave`, `bounce`, `shuffle`, `runningman`, `vibe`, `groove`
### Retro / 80er: `breakdance`, `moonwalk`, `thriller`, `vogue`, `electricslide`, `macarena`
### Cartoon / Fun: `chickendance`, `penguin`, `robotarms`, `cabbagepatch`, `sprinkler`, `lawnmower`
### Epic / Show-Off: `airguitar`, `headbang`, `rave`, `drop`, `slowdance`, `sway`, `poplock`
### Beat-Sync: `beatbounce`, `rhythmstep`, `pulse`, `tempowalk`, `bassdrop`

## Soziale Emotes (20)

### Gruß: `winken` (oder `wave`), `peace`, `thumbsup`
### Emotionen: `lachen` (oder `laugh`), `cry`, `angry`, `surprise`, `heart`
### Konsum: `drink`, `eat`, `cheer`
### Interaktion: `hug`, `highfive`, `kiss`, `box`
### Posen & Spezial: `sit`, `kneel`, `lay`, `confetti`, `dj`

## Bewegungszonen

| Zone | Y-Position | Beschreibung |
|------|-----------|-------------|
| Himmel/Decke | 0% – 15% | Keine Avatare |
| Leinwand-Bereich | 15% – 55% | Keine Avatare (Leinwand-Tabu) |
| **Vorderer Boden** | **55% – 90%** | **Avatare tanzen hier** |
| Unterer Rand | 90% – 100% | Sichtbarkeits-Puffer |

## Tech Stack

- **Electron** — Desktop-App & transparentes Fenster
- **Canvas2D** — 2D-Rendering (60 FPS, 50+ Avatare)
- **tmi.js** — Twitch Chat-Integration
- **WebSocket (ws)** — Admin-Panel Kommunikation
- **South-Park Cutout-Animation** — Skelett-System mit 10 Gelenkpunkten

## Projektstruktur

```
/src/main/          — Electron-Hauptprozess (Twitch-Bot, Spiellogik, WebSocket-Server)
/src/renderer/      — Overlay-Renderer (Canvas2D, Sprite-System, Animations-Engine)
/src/admin/         — Admin-Panel (5-Sektionen UI, WebSocket-Client)
/src/avatar/        — Avatar-Manager (Lebenszyklus, Emotes, Inaktivität)
/src/twitch/        — Twitch-Bot (tmi.js, Befehlserkennung, Rate-Limiting)
/src/beat/          — Beat-Detektor (BPM-Erkennung, Simulation)
/data/animations/   — Animationsdaten (JSON-Frame-Sequenzen pro Emote)
/assets/            — Avatar-Sprite-Sheets, Icons
```

## Entwicklung

```bash
# Installieren
npm install

# Entwicklungsmodus
npm start

# Build (Portable EXE)
npm run build:portable

# Build (Installer)
npm run build:installer
```

## Lizenz

MIT
