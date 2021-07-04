# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `WakuRelay.deleteObserver` to allow removal of observers, useful when a React component add observers when mounting and needs to delete it when unmounting. 
- Keep alive feature that pings host regularly, reducing the chance of connections being dropped due to idle.
  Can be disabled or default frequency (10s) can be changed when calling `Waku.create`. 

### Changed
- **Breaking**: Auto select peer if none provided for store and light push protocols.
- Upgrade to `libp2p@0.31.7` and `libp2p-gossipsub@0.10.0` to avoid `TextEncoder` errors in ReactJS tests.
- Disable keep alive by default as latest nim-waku release does not support ping protocol.

### Fixed
- Disable `keepAlive` if set to `0`.

## [0.7.0] - 2021-06-15

### Changed
- Test: Upgrade nim-waku node to v0.4.
- Waku Light Push upgraded to `2.0.0-beta1`.
- Examples (web chat): Catch error if chat message decoding fails.
- Examples (web chat): Do not send message if shift/alt/ctrl is pressed, enabling multiline messages.

## [0.6.0] - 2021-06-09

### Changed
- **Breaking**: Websocket protocol is not automatically added anymore if the user specifies a protocol in `libp2p.modules`
  when using `Waku.create`.
- **Breaking**: Options passed to `Waku.create` used to be passed to `Libp2p.create`;
  Now, only the `libp2p` property is passed to `Libp2p.create`, allowing for a cleaner interface.
- Examples (cli chat): Use tcp protocol instead of websocket.  

### Added
- Enable access to `WakuMessage.timestamp`.
- Examples (web chat): Use `WakuMessage.timestamp` as unique key for list items.
- Doc: Link to new [topic guidelines](https://rfc.vac.dev/spec/23/) in README.
- Doc: Link to [Waku v2 Toy Chat specs](https://rfc.vac.dev/spec/22/) in README.
- Examples (web chat): Persist nick.
- Support for custom PubSub Topics to `Waku`, `WakuRelay`, `WakuStore` and `WakuLightPush`;
  Passing a PubSub Topic is optional and still defaults to `/waku/2/default-waku/proto`;
  JS-Waku currently supports one, and only, PubSub topic per instance.  

## [0.5.0] - 2021-05-21

### Added
- Implement [Waku v2 Light Push protocol](https://rfc.vac.dev/spec/19/).
- Expose `Direction` enum from js-waku root (it was only accessible via the proto module).
- Examples (cli chat): Use light push to send messages if `--lightPush` is passed.
- Examples (cli chat): Print usage if `--help` is passed.

## [0.4.0] - 2021-05-18

### Added
- `callback` argument to `WakuStore.queryHistory()`, called as messages are retrieved
  ; Messages are retrieved using pagination, and it may take some time to retrieve all messages,
  with the `callback` function, messages are processed as soon as they are received. 

### Changed
- Testing: Upgrade nim-waku node to v0.3.
- **Breaking**: Modify `WakuStore.queryHistory()` to accept one `Object` instead of multiple individual arguments.
- `getStatusFleetNodes` return prod nodes by default, instead of test nodes.
- Examples (web chat): Connect to prod fleet by default, test fleet for local development.
- Examples (cli chat): Connect to test fleet by default, use `--prod` to connect to prod fleet.

### Fixed
- Expose `Enviroment` and `Protocol` enums to pass to `getStatusFleetNodes`.

## [0.3.0] - 2021-05-15

### Added
- `getStatusFleetNodes` to connect to Status' nim-waku nodes.

### Changed
- Clarify content topic format in README.md.

## Removed
- Unused dependencies.

## [0.2.0] - 2021-05-14

### Added
- `WakuRelay.getPeers` method.
- Use `WakuRelay.getPeers` in web chat app example to disable send button.

### Changed
- Enable passing `string`s to `addPeerToAddressBook`.
- Use `addPeerToAddressBook` in examples and usage doc.
- Settle on `js-waku` name across the board.
- **Breaking**: `RelayDefaultTopic` renamed to `DefaultPubsubTopic`.

## [0.1.0] - 2021-05-12

### Added
- Add usage section to the README.
- Support of [Waku v2 Relay](https://rfc.vac.dev/spec/11/).
- Support of [Waku v2 Store](https://rfc.vac.dev/spec/13/).
- [Node Chat App example](./examples/cli-chat).
- [ReactJS Chat App example](./examples/web-chat).
- [Typedoc Documentation](https://status-im.github.io/js-waku/docs).

[Unreleased]: https://github.com/status-im/js-waku/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/status-im/js-waku/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/status-im/js-waku/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/status-im/js-waku/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/status-im/js-waku/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/status-im/js-waku/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/status-im/js-waku/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/status-im/js-waku/compare/f46ce77f57c08866873b5c80acd052e0ddba8bc9...v0.1.0