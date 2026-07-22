# @thoth/relay

Relay package for Thoth.

Intended responsibilities:

1. Zero-knowledge E2EE WebSocket relay.
2. Daemon channel routing.
3. Client channel routing.
4. Pairing session routing.
5. Ciphertext forwarding only.

Relay rules:

1. No task truth.
2. No plaintext.
3. No offline queue.
