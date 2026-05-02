# OpenSpace Wochenende

Statische Website für ein Open-Space-Wochenende mit ein paar Freunden.
Daten leben als JSON im Repo, Bearbeitungen schreiben über die GitHub Contents API zurück. Kein Server, kein Build, keine Kosten.

## Was die App kann

- **Vision-Board** — Vorschläge für Motto, Überschrift, Ziele, Vision sammeln und voten. Top-Vorschlag steht oben.
- **Sessions** — frei konfigurierbarer Zeitrahmen (Start, Ende, Slot-Länge), 1 Track. Klick auf einen Slot füllt ihn.
- **Settings** — Konfiguration und GitHub-Token im Browser.

## Lokal starten

```sh
cd openspace
python3 -m http.server 8000
# → http://localhost:8000
```

Lokal kann gelesen, aber nicht in Git zurückgeschrieben werden, bis ein Repo + Token unter Settings hinterlegt sind.

## Auf GitHub Pages deployen

1. Neues GitHub-Repo anlegen (public), z. B. `openspace-weekend`.
2. Inhalt dieses Ordners pushen:

   ```sh
   git init
   git add .
   git commit -m "init"
   git branch -M main
   git remote add origin https://github.com/<owner>/<repo>.git
   git push -u origin main
   ```

3. Repo → **Settings → Pages → Source = `main` / root**.
4. URL ist dann `https://<owner>.github.io/<repo>/`.

## Schreibrechte (Personal Access Token)

Die App schreibt JSON-Dateien direkt zurück ins Repo. Jeder Editor braucht ein **Fine-grained Personal Access Token**:

1. github.com → Settings → Developer settings → Personal access tokens → Fine-grained tokens → **Generate new token**
2. **Repository access:** *Only select repositories* → dieses Repo
3. **Permissions:** *Repository permissions* → *Contents: Read and write*
4. Ablaufdatum auf den Sonntag nach dem Wochenende setzen.
5. Token kopieren, in der App unter **Settings → GitHub-Verbindung** einfügen. Owner / Repo / Branch dort ebenfalls eintragen (auf Pages werden sie automatisch erkannt).
6. Token bleibt nur im Browser (`localStorage`), wird nie ins Repo committet.

## Daten

- `data/config.json` — Titel, Start, Ende, Slot-Länge
- `data/vision.json` — Vorschläge und Votes
- `data/sessions.json` — befüllte Slots

## Stack

Vanilla HTML / CSS / JS. Keine Dependencies, kein Build. Google Fonts werden vom CDN geladen.
