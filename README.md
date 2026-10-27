# Beniaminu Demurtas — Flipbook

Versione statica pronta per GitHub Pages. Conserva il lettore del file originale: pagine animate, zoom, audio, navigazione da tastiera, lettura su telefono e tutto schermo quando supportato dal browser. PDF, sfondo e librerie sono inclusi; non richiede installazioni, compilazione o servizi esterni.

## Pubblicazione dal sito GitHub

1. Crea un repository, per esempio `flipbook`. Con GitHub Free scegli un repository pubblico.
2. Apri **Add file → Upload files**.
3. Carica **il contenuto di questa cartella**: `index.html`, la cartella `assets`, `README.md` e `.nojekyll`. Il file `index.html` deve trovarsi nella radice del repository. Se usi lo ZIP, estrailo prima: GitHub non estrae automaticamente gli archivi.
4. Conferma con **Commit changes**.
5. Apri **Settings → Pages**.
6. In **Build and deployment**, seleziona **Deploy from a branch**, il ramo **main** (o quello nel quale hai caricato i file), la cartella **/(root)** e premi **Save**.
7. Dopo la pubblicazione, in questa stessa pagina comparirà **Visit site**. L'indirizzo sarà simile a `https://NOMEUTENTE.github.io/flipbook/`.

La pubblicazione può richiedere fino a 10 minuti. Il sito di lettura è il collegamento GitHub Pages; l'anteprima del file nella scheda Code mostra il sorgente HTML.

Tutti i collegamenti sono relativi, quindi il lettore funziona anche quando il repository è pubblicato in una sottocartella. Le risorse sono suddivise per poterle caricare separatamente dal browser.

## Aggiornare il libro

Sostituisci `assets/book.pdf` mantenendo lo stesso nome. Puoi modificare il titolo e la descrizione in `index.html`. Per modificare lo sfondo, sostituisci `assets/background.jpg`.

## Anteprima locale

Questa versione carica il PDF con HTTP/HTTPS. Per provarla sul computer, servi la cartella con un server locale; il doppio clic sul file HTML non è un'anteprima equivalente. Per esempio, se Python è installato, apri un terminale in questa cartella, esegui `python -m http.server 8000` e visita `http://localhost:8000`.

## File inclusi

- `index.html`: pagina iniziale.
- `assets/style.css`: stile del lettore.
- `assets/reader.js`: logica del lettore originale adattata alle risorse esterne.
- `assets/book.pdf`: PDF originale, estratto senza modifiche.
- `assets/background.jpg` e `assets/page-turn.mp3`: sfondo e suono originali.
- `assets/vendor/`: copie di PDF.js, del suo worker e di PageFlip estratte dal file originale; le intestazioni di licenza presenti sono conservate.
- `.nojekyll`: disabilita l'elaborazione Jekyll.

Documentazione ufficiale: [creare un sito GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site) e [configurare la pubblicazione](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).
