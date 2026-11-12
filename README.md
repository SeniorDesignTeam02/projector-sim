# Senior Design Team 02 - Projector Sim

A browser simulator for turning the team's 720p projector into a short-throw projector that lights a kitchen countertop, by trying different projector positions and externally placed mirrors.

Live at https://sim.nateobrien.dev and https://projector-simulation.web.app. There is no login: anyone with the link can read and change scenes.

## Run

```sh
python3 -m http.server -d public
```

Then open http://localhost:8000. It uses the same live database as the deployed site.

## Deploy

One-time:

```sh
npx firebase-tools login
```

Then:

```sh
npx firebase-tools deploy
```

## More

`AGENTS.md` describes the files, the data layout and how the model works.
