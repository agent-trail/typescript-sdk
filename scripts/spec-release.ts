import type { FixturesAsset, SchemaAsset } from "./spec-artifacts.ts";

export const SPEC_VERSION = "0.1.0";
export const RELEASE_TAG = `v${SPEC_VERSION}`;
export const RELEASE_URL = `https://github.com/agent-trail/spec/releases/tag/${RELEASE_TAG}`;
const RELEASE_DOWNLOAD_URL = `https://github.com/agent-trail/spec/releases/download/${RELEASE_TAG}`;

export const SCHEMA_ASSET: SchemaAsset = {
  name: `schema-${RELEASE_TAG}.json`,
  url: `${RELEASE_DOWNLOAD_URL}/schema-${RELEASE_TAG}.json`,
  sha256: "bf13df1edca229e28665c34b7937525e4b23443f730eed5299498a8262fcd7f5",
  targetPath: "schema/v0.1.0.json",
};

export const FIXTURES_ASSET: FixturesAsset = {
  name: `fixtures-${RELEASE_TAG}.tar.gz`,
  url: `${RELEASE_DOWNLOAD_URL}/fixtures-${RELEASE_TAG}.tar.gz`,
  sha256: "c47679370637f56e593eefa630be2cfb2fcc207becf63805dec31e832d8f63df",
  targetPath: "fixtures",
};

export const CHECKSUMS_URL = `${RELEASE_DOWNLOAD_URL}/checksums-${RELEASE_TAG}.txt`;
