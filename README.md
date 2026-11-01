# StillStream

[![CI](https://github.com/Karasune-Kamyshiro/StillStream/actions/workflows/ci.yml/badge.svg)](https://github.com/Karasune-Kamyshiro/StillStream/actions/workflows/ci.yml)

A controller-first Twitch client for Linux TVs and handhelds. Browse from the sofa with
four arrow keys, Enter, and Escape, or a gamepad. Playback uses Twitch's official player.

![StillStream homepage in guest mode, with controller navigation, Quick watch channels, and game categories](docs/images/homepage.png)

Guest-mode homepage captured during 4K interface testing. Channel previews depend on availability.

**Early-stage software.** Linux x86_64 builds target HTPCs, Steam Deck, and Bazzite.
Physical Steam Deck/Bazzite validation and authenticated playback testing remain ongoing;
these are target platforms, not a hardware certification. Windows, macOS, and ARM builds
are not currently provided.

## Get started

Install the Flatpak from the StillStream repository so it updates like any other app:

```sh
flatpak install --user https://karasune-kamyshiro.github.io/StillStream/io.github.karasune.StillStream.flatpakref
```

Pre-releases come through the beta branch (`…/io.github.karasune.StillStream-beta.flatpakref`).
An AppImage is on [GitHub Releases](https://github.com/Karasune-Kamyshiro/StillStream/releases);
the app tells you in Settings when a new version is out. Then follow the
[installation and first-run guide](docs/users/getting-started.md).
To make it look at home in Steam, add it as a non-Steam game and use the
[Steam artwork](artwork/steam/README.md) (capsules, hero, logo and icon).
If there is no published release yet, use the [source setup](docs/contributing/development.md).

- Watch quick-pick channels or search an exact channel name without signing in.
- Connect your Twitch account to browse live streams, followed channels, categories, and VODs.
- A public Twitch Client ID is built in. You do **not** need to register a developer application.
- **Sign in with Twitch** in Settings connects discovery and signs the embedded player in, so
  subscriber and Turbo ad-free benefits apply. A code-on-another-device option remains.
- Twitch controls ads, availability, and player errors. StillStream does not bypass them.

## Documentation

| I want to… | Start here |
| --- | --- |
| Install, sign in, or use a controller | [User guide](docs/users/getting-started.md) |
| Troubleshoot playback, login, or startup | [Troubleshooting](docs/users/troubleshooting.md) |
| Report a bug or contribute | [Contributing](CONTRIBUTING.md) |
| Run or change the source | [Development](docs/contributing/development.md) |
| Understand the security boundaries | [Architecture](docs/contributing/architecture.md) |
| See what is being worked on and why | [Improvement ledger](docs/contributing/improvement-ledger.md) |
| Change the interface | [Design contract](docs/contributing/design.md) |
| Publish a version | [Maintainer release guide](docs/maintainers/releases.md) |
| Report a vulnerability | [Security policy](SECURITY.md) |

## Project

StillStream is maintained by [@Karasune-Kamyshiro](https://github.com/Karasune-Kamyshiro). It began
as a fork of **VacuumStream** by [Eliott Bouhana (@eliottness)](https://github.com/eliottness); see the
[original repository](https://github.com/eliottness/VacuumStream) and its
[contributors](https://github.com/eliottness/VacuumStream/graphs/contributors).
The application ID is `io.github.karasune.StillStream`.

Inspired by VacuumTube's controller-first approach. Twitch has no equivalent supported
Leanback interface, so StillStream provides its own interface using Helix, Device Code Flow,
and the official Twitch player rather than extracting stream URLs.

[MIT licensed](LICENSE). Twitch is a trademark of Twitch Interactive, Inc.
StillStream is not affiliated with or endorsed by Twitch.
