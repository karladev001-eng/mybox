# App Catalog

This directory owns the Host-side catalog of installable MyBox App surfaces.

- `registry.js`: validates versioned App definitions, prevents ID collisions,
  exposes the built-in catalog, and resolves the default installed set.

Definitions describe launcher metadata, a SemVer release, and either a generic surface or a lazy
module surface. They do not grant Operations, storage, provider tools, or data
access; those remain separate Host contracts. Installed App/version records and
serializable custom definitions are persisted by `../core/app-installations.js`
through the device Host storage adapter. Registry versions describe available
trusted Surfaces; installed versions are separate device state.
