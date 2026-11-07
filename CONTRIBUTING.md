# Contributing to Coast

Contributions are welcome in the form of issues and pull requests on GitHub.

## Running the program

The program has no build step. It is served from the root of the repository by any static web server, for example `python3 -m http.server 8765 --bind 127.0.0.1`, and opened at <http://127.0.0.1:8765/>. The section "Development" of `README.md` describes a syntax check and the debug hooks exposed on `window.__village`.

## Changes

- The program is contained in `index.html`, apart from the cat in `cat/`. A change should follow the style of the code round it and should not reformat unrelated code.
- Every visual change should be checked by rendering the scene and looking at the result, from near and from far, before it is submitted. A screenshot of the result should be attached to the pull request.
- New trees, plants and props are developed first in a page of `testbench/` and enter the game only once they have been approved.
- Performance is measured with the overlay shown by **O**. A change should not reduce the frame rate or lengthen the generation of blocks noticeably.
- `README.md` describes the design of every feature. A change of behaviour should be described there, and a change of controls in the help panel, in `README.md` and in `docs/user-guide.md`.

## Conventions

- Labels, place names and values are shown on screen, but explanatory notes and hints are not. Explanations belong in the documentation or, at most, in a tooltip.
- Text is written in plain descriptive sentences. Slogans and taglines are not used, in the interface, the documentation or commit messages.
- British spelling is used throughout.
- Commit messages describe the change in plain sentences.

## Licence

By contributing, the contributor agrees that the contribution is licensed under the MIT licence of the project (`LICENSE`). The cat in `cat/` keeps its own MIT licence (`cat/LICENSE`).
