import type { FixturesAsset, SchemaAsset } from "./spec-artifacts.ts";

export const SPEC_VERSION = "0.1.0";
export const RELEASE_TAG = `v${SPEC_VERSION}`;
export const RELEASE_URL = `https://github.com/agent-trail/spec/releases/tag/${RELEASE_TAG}`;
const RELEASE_DOWNLOAD_URL = `https://github.com/agent-trail/spec/releases/download/${RELEASE_TAG}`;

export const SCHEMA_ASSET: SchemaAsset = {
  name: `schema-${RELEASE_TAG}.json`,
  url: `${RELEASE_DOWNLOAD_URL}/schema-${RELEASE_TAG}.json`,
  sha256: "b9012b15968b6be0ffe43c998cdf49d88b045176f21a4b5a20570106c79e5ad6",
  targetPath: "schema/v0.1.0.json",
};

export const FIXTURES_ASSET: FixturesAsset = {
  name: `fixtures-${RELEASE_TAG}.tar.gz`,
  url: `${RELEASE_DOWNLOAD_URL}/fixtures-${RELEASE_TAG}.tar.gz`,
  sha256: "89235c13ca3d43c49fccdd474fb30feb74965eadca5924e8f5dd6936054ea7c8",
  targetPath: "fixtures",
};

export const CHECKSUMS_URL = `${RELEASE_DOWNLOAD_URL}/checksums-${RELEASE_TAG}.txt`;
