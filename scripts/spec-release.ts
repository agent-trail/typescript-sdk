import type { FixturesAsset, SchemaAsset } from "./spec-artifacts.ts";

export const SPEC_VERSION = "0.1.0";
export const RELEASE_TAG = `v${SPEC_VERSION}`;
export const RELEASE_URL = `https://github.com/agent-trail/spec/releases/tag/${RELEASE_TAG}`;
const RELEASE_DOWNLOAD_URL = `https://github.com/agent-trail/spec/releases/download/${RELEASE_TAG}`;

export const SCHEMA_ASSET: SchemaAsset = {
  name: `schema-${RELEASE_TAG}.json`,
  url: `${RELEASE_DOWNLOAD_URL}/schema-${RELEASE_TAG}.json`,
  sha256: "5bff387f55f0c35d7cd947eba17a94a8b8a5e4f38a729dd6b71478473ed45c97",
  targetPath: "schema/v0.1.0.json",
};

export const FIXTURES_ASSET: FixturesAsset = {
  name: `fixtures-${RELEASE_TAG}.tar.gz`,
  url: `${RELEASE_DOWNLOAD_URL}/fixtures-${RELEASE_TAG}.tar.gz`,
  sha256: "321621ddf3c14de349e47cba73e1c04ada5126e7300a677e4bd940c800b3e9ba",
  targetPath: "fixtures",
};

export const CHECKSUMS_URL = `${RELEASE_DOWNLOAD_URL}/checksums-${RELEASE_TAG}.txt`;
