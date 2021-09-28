import { bytes } from '@chainsafe/libp2p-noise/dist/src/@types/basic';
import { Noise } from '@chainsafe/libp2p-noise/dist/src/noise';
import debug from 'debug';
import Libp2p, { Connection, Libp2pModules, Libp2pOptions } from 'libp2p';
import Bootstrap from 'libp2p-bootstrap';
import { MuxedStream } from 'libp2p-interfaces/dist/src/stream-muxer/types';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore: No types available
import Mplex from 'libp2p-mplex';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore: No types available
import Websockets from 'libp2p-websockets';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore: No types available
import filters from 'libp2p-websockets/src/filters';
import { Peer } from 'libp2p/dist/src/peer-store';
import Ping from 'libp2p/src/ping';
import { Multiaddr, multiaddr } from 'multiaddr';
import PeerId from 'peer-id';

import { getPeersForProtocol } from './select_peer';
import { LightPushCodec, WakuLightPush } from './waku_light_push';
import { WakuMessage } from './waku_message';
import { RelayCodecs, WakuRelay } from './waku_relay';
import { RelayPingContentTopic } from './waku_relay/constants';
import { StoreCodec, WakuStore } from './waku_store';
import { BootstrapOptions, parseBootstrap } from './discovery/bootstrap';

const websocketsTransportKey = Websockets.prototype[Symbol.toStringTag];

export const DefaultPingKeepAliveValueSecs = 0;
export const DefaultRelayKeepAliveValueSecs = 5 * 60;

/**
 * DefaultPubSubTopic is the default gossipsub topic to use for Waku.
 */
export const DefaultPubSubTopic = '/waku/2/default-waku/proto';

const dbg = debug('waku:waku');

export interface CreateOptions {
  /**
   * The PubSub Topic to use. Defaults to {@link DefaultPubSubTopic}.
   *
   * One and only one pubsub topic is used by Waku. This is used by:
   * - WakuRelay to receive, route and send messages,
   * - WakuLightPush to send messages,
   * - WakuStore to retrieve messages.
   *
   * The usage of the default pubsub topic is recommended.
   * See [Waku v2 Topic Usage Recommendations](https://rfc.vac.dev/spec/23/) for details.
   *
   * @default {@link DefaultPubSubTopic}
   */
  pubSubTopic?: string;
  /**
   * Set keep alive frequency in seconds: Waku will send a `/ipfs/ping/1.0.0`
   * request to each peer after the set number of seconds. Set to 0 to disable.
   *
   * @default {@link DefaultPingKeepAliveValueSecs}
   */
  pingKeepAlive?: number;
  /**
   * Set keep alive frequency in seconds: Waku will send a ping message over
   * relay to each peer after the set number of seconds. Set to 0 to disable.
   *
   * @default {@link DefaultRelayKeepAliveValueSecs}
   */
  relayKeepAlive?: number;
  /**
   * You can pass options to the `Libp2p` instance used by {@link Waku} using the {@link CreateOptions.libp2p} property.
   * This property is the same type than the one passed to [`Libp2p.create`](https://github.com/libp2p/js-libp2p/blob/master/doc/API.md#create)
   * apart that we made the `modules` property optional and partial,
   * allowing its omission and letting Waku set good defaults.
   * Notes that some values are overridden by {@link Waku} to ensure it implements the Waku protocol.
   */
  libp2p?: Omit<Libp2pOptions & import('libp2p').CreateOptions, 'modules'> & {
    modules?: Partial<Libp2pModules>;
  };
  /**
   * Byte array used as key for the noise protocol used for connection encryption
   * by [`Libp2p.create`](https://github.com/libp2p/js-libp2p/blob/master/doc/API.md#create)
   * This is only used for test purposes to not run out of entropy during CI runs.
   */
  staticNoiseKey?: bytes;
  /**
   * Use libp2p-bootstrap to discover and connect to new nodes.
   *
   * See [BootstrapOptions] for available parameters.
   *
   * Note: It overrides any other peerDiscovery modules that may have been set via
   * {@link CreateOptions.libp2p}.
   */
  bootstrap?: BootstrapOptions | boolean | string[] | (() => string[] | Promise<string[]>);
  decryptionKeys?: Array<Uint8Array | string>;
}

export class Waku {
  public libp2p: Libp2p;
  public relay: WakuRelay;
  public store: WakuStore;
  public lightPush: WakuLightPush;

  private pingKeepAliveTimers: {
    [peer: string]: ReturnType<typeof setInterval>;
  };
  private relayKeepAliveTimers: {
    [peer: string]: ReturnType<typeof setInterval>;
  };

  private constructor(
    options: CreateOptions,
    libp2p: Libp2p,
    store: WakuStore,
    lightPush: WakuLightPush
  ) {
    this.libp2p = libp2p;
    this.relay = libp2p.pubsub as unknown as WakuRelay;
    this.store = store;
    this.lightPush = lightPush;
    this.pingKeepAliveTimers = {};
    this.relayKeepAliveTimers = {};

    const pingKeepAlive =
      options.pingKeepAlive || DefaultPingKeepAliveValueSecs;
    const relayKeepAlive =
      options.relayKeepAlive || DefaultRelayKeepAliveValueSecs;

    libp2p.connectionManager.on('peer:connect', (connection: Connection) => {
      this.startKeepAlive(connection.remotePeer, pingKeepAlive, relayKeepAlive);
    });

    libp2p.connectionManager.on('peer:disconnect', (connection: Connection) => {
      this.stopKeepAlive(connection.remotePeer);
    });

    options?.decryptionKeys?.forEach(this.addDecryptionKey);
  }

  /**
   * Create new waku node
   *
   * @param options Takes the same options than `Libp2p`.
   */
  static async create(options?: CreateOptions): Promise<Waku> {
    // Get an object in case options or libp2p are undefined
    const libp2pOpts = Object.assign({}, options?.libp2p);

    // Default for Websocket filter is `all`:
    // Returns all TCP and DNS based addresses, both with ws or wss.
    libp2pOpts.config = Object.assign(
      {
        transport: {
          [websocketsTransportKey]: {
            filter: filters.all,
          },
        },
      },
      options?.libp2p?.config
    );

    // Pass pubsub topic to relay
    if (options?.pubSubTopic) {
      libp2pOpts.config.pubsub = Object.assign(
        { pubSubTopic: options.pubSubTopic },
        libp2pOpts.config.pubsub
      );
    }

    libp2pOpts.modules = Object.assign({}, options?.libp2p?.modules);

    // Default transport for libp2p is Websockets
    libp2pOpts.modules = Object.assign(
      {
        transport: [Websockets],
      },
      options?.libp2p?.modules
    );

    // streamMuxer, connection encryption and pubsub are overridden
    // as those are the only ones currently supported by Waku nodes.
    libp2pOpts.modules = Object.assign(libp2pOpts.modules, {
      streamMuxer: [Mplex],
      connEncryption: [new Noise(options?.staticNoiseKey)],
      pubsub: WakuRelay,
    });

    if (options?.bootstrap) {
      const bootstrap = parseBootstrap(options?.bootstrap);

      if (bootstrap !== undefined) {
        try {
          const list = await bootstrap();

          // Note: this overrides any other peer discover
          libp2pOpts.modules = Object.assign(libp2pOpts.modules, {
            peerDiscovery: [Bootstrap],
          });

          libp2pOpts.config.peerDiscovery = {
            [Bootstrap.tag]: {
              list,
              enabled: true,
            },
          };
        } catch (e) {
          dbg('Failed to retrieve bootstrap nodes', e);
        }
      }
    }

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore: modules property is correctly set thanks to voodoo
    const libp2p = await Libp2p.create(libp2pOpts);

    const wakuStore = new WakuStore(libp2p, {
      pubSubTopic: options?.pubSubTopic,
    });
    const wakuLightPush = new WakuLightPush(libp2p);

    await libp2p.start();

    return new Waku(options ? options : {}, libp2p, wakuStore, wakuLightPush);
  }

  /**
   * Dials to the provided peer.
   *
   * @param peer The peer to dial
   */
  async dial(peer: PeerId | Multiaddr | string): Promise<{
    stream: MuxedStream;
    protocol: string;
  }> {
    return this.libp2p.dialProtocol(peer, [StoreCodec].concat(RelayCodecs));
  }

  /**
   * Add peer to address book, it will be auto-dialed in the background.
   */
  addPeerToAddressBook(
    peerId: PeerId | string,
    multiaddrs: Multiaddr[] | string[]
  ): void {
    let peer;
    if (typeof peerId === 'string') {
      peer = PeerId.createFromB58String(peerId);
    } else {
      peer = peerId;
    }
    const addresses = multiaddrs.map((addr: Multiaddr | string) => {
      if (typeof addr === 'string') {
        return multiaddr(addr);
      } else {
        return addr;
      }
    });
    this.libp2p.peerStore.addressBook.set(peer, addresses);
  }

  async stop(): Promise<void> {
    return this.libp2p.stop();
  }

  /**
   * Register a decryption key to attempt decryption of messages received via
   * [[WakuRelay]] and [[WakuStore]]. This can either be a private key for
   * asymmetric encryption or a symmetric key.
   *
   * Strings must be in hex format.
   */
  addDecryptionKey(key: Uint8Array | string): void {
    this.relay.addDecryptionKey(key);
    this.store.addDecryptionKey(key);
  }

  /**
   * Delete a decryption key that was used to attempt decryption of messages
   * received via [[WakuRelay]] or [[WakuStore]].
   *
   * Strings must be in hex format.
   */
  deleteDecryptionKey(key: Uint8Array | string): void {
    this.relay.deleteDecryptionKey(key);
    this.store.deleteDecryptionKey(key);
  }

  /**
   * Return the local multiaddr with peer id on which libp2p is listening.
   * @throws if libp2p is not listening on localhost
   */
  getLocalMultiaddrWithID(): string {
    const localMultiaddr = this.libp2p.multiaddrs.find((addr) =>
      addr.toString().match(/127\.0\.0\.1/)
    );
    if (!localMultiaddr || localMultiaddr.toString() === '') {
      throw 'Not listening on localhost';
    }
    return localMultiaddr + '/p2p/' + this.libp2p.peerId.toB58String();
  }

  /**
   * Wait to be connected to a peer. Useful when using the [[CreateOptions.bootstrap]]
   * with [[Waku.create]]. The Promise resolves only once we are connected to a
   * Store peer, Relay peer and Light Push peer.
   */
  async waitForConnectedPeer(): Promise<void> {
    const desiredProtocols = [[StoreCodec], [LightPushCodec], RelayCodecs];

    await Promise.all(
      desiredProtocols.map((desiredProtocolVersions) => {
        const peers = new Array<Peer>();
        desiredProtocolVersions.forEach((proto) => {
          getPeersForProtocol(this.libp2p, proto).forEach((peer) =>
            peers.push(peer)
          );
        });
        dbg('peers for ', desiredProtocolVersions, peers);

        if (peers.length > 0) {
          return Promise.resolve();
        } else {
          // No peer available for this protocol, waiting to connect to one.
          return new Promise<void>((resolve) => {
            this.libp2p.peerStore.on(
              'change:protocols',
              ({ protocols: connectedPeerProtocols }) => {
                desiredProtocolVersions.forEach((desiredProto) => {
                  if (connectedPeerProtocols.includes(desiredProto)) {
                    dbg('Resolving for', desiredProto, connectedPeerProtocols);
                    resolve();
                  }
                });
              }
            );
          });
        }
      })
    );
  }

  private startKeepAlive(
    peerId: PeerId,
    pingPeriodSecs: number,
    relayPeriodSecs: number
  ): void {
    // Just in case a timer already exist for this peer
    this.stopKeepAlive(peerId);

    const peerIdStr = peerId.toB58String();

    if (pingPeriodSecs !== 0) {
      this.pingKeepAliveTimers[peerIdStr] = setInterval(() => {
        Ping(this.libp2p, peerId);
      }, pingPeriodSecs * 1000);
    }

    if (relayPeriodSecs !== 0) {
      this.relayKeepAliveTimers[peerIdStr] = setInterval(() => {
        WakuMessage.fromBytes(new Uint8Array(), RelayPingContentTopic).then(
          (wakuMsg) => this.relay.send(wakuMsg)
        );
      }, relayPeriodSecs * 1000);
    }
  }

  private stopKeepAlive(peerId: PeerId): void {
    const peerIdStr = peerId.toB58String();

    if (this.pingKeepAliveTimers[peerIdStr]) {
      clearInterval(this.pingKeepAliveTimers[peerIdStr]);
      delete this.pingKeepAliveTimers[peerIdStr];
    }

    if (this.relayKeepAliveTimers[peerIdStr]) {
      clearInterval(this.relayKeepAliveTimers[peerIdStr]);
      delete this.relayKeepAliveTimers[peerIdStr];
    }
  }
}
